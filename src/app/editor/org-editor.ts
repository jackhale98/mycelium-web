/// CodeMirror 6 setup for editing org source. Highlighting comes from the
/// line highlighter in `$lib/org/highlight`; link markup is folded away
/// (live preview) except on the line being edited, and typing `[[` offers
/// nodes to link to — or a new node with that title.

import {
	autocompletion,
	closeBrackets,
	closeBracketsKeymap,
	completionKeymap,
	type Completion,
	type CompletionContext,
	type CompletionResult,
} from '@codemirror/autocomplete';
import { matchRank } from './match';
import {
	checkboxToggle,
	continueList,
	indentItem,
	outdentItem,
	outdentListItem,
	toggleItemCheckbox,
} from './list-commands';
import * as table from './table-commands';
import { cycleHeading, cycleOutlineCommand, folding } from './fold-commands';
export { cycleOutline, startupFolds } from './fold-commands';
import { texCompletion, texRedraw, texSupport } from './tex-editor';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import {
	Annotation,
	EditorState,
	RangeSetBuilder,
	StateEffect,
	type Extension,
} from '@codemirror/state';
import {
	Decoration,
	drawSelection,
	EditorView,
	keymap,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';
import {
	highlightLine,
	initialHighlightState,
	type KeywordConfig,
	type RoamNode,
	type HighlightSpan,
} from '$lib/org';

export interface EditorHooks {
	keywords: () => KeywordConfig;
	nodes: () => Iterable<RoamNode>;
	/** Create a node with this title; returns its id. */
	createNode: (title: string) => string | null;
	/** Follow a link target (`id:…`, `https:…`). */
	/** Open a link's target; `beside`: in the other pane (⌘/Ctrl-Alt-click). */
	follow: (target: string, beside?: boolean) => void;
	onChange: (text: string) => void;
	/** Live preview (markup hidden away from the cursor), or plain source. */
	livePreview?: () => boolean;
	/** A picture was pasted or dropped at `pos`. */
	onImage?: (file: File, pos: number) => void;
	/** Focus moved in or out, or the cursor moved (for the formatting bar). */
	onCursor?: (view: EditorView) => void;
	/** Link suggestions in this text: other notes' titles written as plain words. */
	mentions?: (text: string) => EditorMention[];
	/** Choose a note to link `words` (or the cursor) to: the Link to… picker. */
	linkTo?: (words: string | null, done: (id: string, title: string) => void) => void;
	/** The note whose `ROAM_REFS` include this URL, if any. */
	refFor?: (url: string) => { id: string; title: string } | null;
	/** A note's source URL was pasted at `from`–`to`: offer to link the note instead. */
	onRefPaste?: (paste: {
		from: number;
		to: number;
		url: string;
		id: string;
		title: string;
	}) => void;
}

export interface EditorMention {
	from: number;
	to: number;
	text: string;
	id: string;
	title: string;
}

/** Marks changes that came from outside the editor (so they aren't echoed back). */
const external = Annotation.define<boolean>();

/** An org bracket link, `[[target]]` or `[[target][description]]`. */
const LINK_RE = /\[\[(?:[^\]\\]|\\.)+\](?:\[(?:[^\]]|\](?!\]))*\])?\]/g;

const lineDeco = new Map<string, Decoration>();
const markDeco = new Map<string, Decoration>();
const hidden = Decoration.replace({});
const line = (cls: string) =>
	lineDeco.get(cls) ?? lineDeco.set(cls, Decoration.line({ class: cls })).get(cls)!;
const mark = (cls: string, attrs?: Record<string, string>) => {
	const key = attrs ? `${cls}|${JSON.stringify(attrs)}` : cls;
	return (
		markDeco.get(key) ??
		markDeco
			.set(key, Decoration.mark({ class: cls, ...(attrs ? { attributes: attrs } : {}) }))
			.get(key)!
	);
};

function spanClass(span: HighlightSpan): string {
	if (span.kind === 'checkbox') return `cm-org-checkbox${span.data === ' ' ? '' : ' checked'}`;
	return `cm-org-${span.kind}`;
}

/** Redraw decorations (after the live preview setting changes). */
export const redecorate = StateEffect.define<null>();

/** Switch between live preview and source after the setting changes. */
export function refreshPreview(view: EditorView) {
	view.dispatch({ effects: [redecorate.of(null), texRedraw.of(null)] });
}

/** A `-` or `+` bullet, drawn as a dot. */
class BulletWidget extends WidgetType {
	override eq() {
		return true;
	}
	toDOM() {
		const el = document.createElement('span');
		el.className = 'cm-org-dot';
		el.textContent = '•';
		return el;
	}
}
const bullet = Decoration.replace({ widget: new BulletWidget() });

/** A checkbox you can tick, standing in for `[ ]` / `[X]` / `[-]`. */
class CheckboxWidget extends WidgetType {
	constructor(readonly state: string) {
		super();
	}
	override eq(other: CheckboxWidget) {
		return other.state === this.state;
	}
	toDOM(view: EditorView) {
		const box = document.createElement('input');
		box.type = 'checkbox';
		box.className = 'cm-org-box';
		box.checked = this.state !== ' ';
		box.indeterminate = this.state === '-';
		box.setAttribute('aria-label', 'Toggle item');
		box.addEventListener('mousedown', (e) => e.preventDefault());
		box.addEventListener('click', (e) => {
			e.preventDefault();
			const changes = checkboxToggle(view.state, view.posAtDOM(box));
			if (changes) view.dispatch({ changes, userEvent: 'input' });
		});
		return box;
	}
	override ignoreEvent() {
		return true;
	}
}
const checkboxes = new Map<string, Decoration>();
const checkbox = (state: string) =>
	checkboxes.get(state) ??
	checkboxes.set(state, Decoration.replace({ widget: new CheckboxWidget(state) })).get(state)!;

function build(
	view: EditorView,
	keywords: KeywordConfig,
	live: boolean,
): { all: DecorationSet; hidden: DecorationSet } {
	const doc = view.state.doc;
	const builder = new RangeSetBuilder<Decoration>();
	const hiddenBuilder = new RangeSetBuilder<Decoration>();
	const state = initialHighlightState();
	const selection = view.state.selection.ranges;
	const lastVisible = view.visibleRanges.at(-1)?.to ?? doc.length;
	const firstVisible = view.visibleRanges[0]?.from ?? 0;
	const lastLine = doc.lineAt(lastVisible).number;
	for (let n = 1; n <= lastLine; n++) {
		const l = doc.line(n);
		const info = highlightLine(l.text, state, keywords);
		if (l.to < firstVisible) continue;
		const cls =
			info.kind === 'headline'
				? `cm-org-h cm-org-h${Math.min(info.level, 4)}`
				: info.kind
					? `cm-org-l-${info.kind}`
					: null;
		if (cls) builder.add(l.from, l.from, line(cls));
		// A link shows its markup only while the cursor is in that link: the
		// rest of the line keeps its folded links, so it doesn't rewrap.
		const links = info.spans.some((sp) => sp.kind === 'link-markup')
			? [...l.text.matchAll(LINK_RE)].map((m) => [l.from + m.index, l.from + m.index + m[0].length])
			: [];
		const open = (at: number) =>
			links.some(
				([a, b]) => a! <= at && at < b! && selection.some((r) => r.from <= b! && r.to >= a!),
			);
		// Live preview: other markup hides too, each piece only where the cursor isn't.
		const touched = (a: number, b: number) => selection.some((r) => r.from <= b && r.to >= a);
		const lineActive = touched(l.from, l.to);
		const hide = (from: number, to: number, deco: Decoration = hidden) => {
			builder.add(from, to, deco);
			hiddenBuilder.add(from, to, deco);
		};
		const spans = info.spans;
		for (let i = 0; i < spans.length; i++) {
			const span = spans[i]!;
			if (span.from === span.to) continue;
			const from = l.from + span.from;
			const to = l.from + span.to;
			if (live && span.kind === 'markup' && info.kind !== 'table') {
				// (Not in tables: hiding marks there would knock the columns out of line.)
				// Emphasis comes as marker, text, marker: hide both markers unless the
				// cursor is in that span.
				const pair = spans[i + 2]?.kind === 'markup' ? spans[i + 2]! : null;
				const close = !pair && spans[i - 2]?.kind === 'markup' ? spans[i - 2]! : null;
				const a = l.from + (pair ? span.from : (close?.from ?? span.from));
				const b = l.from + (pair ? pair.to : span.to);
				if (!touched(a, b)) hide(from, to);
				else builder.add(from, to, mark(spanClass(span)));
			} else if (live && span.kind === 'stars' && !lineActive && span.to > 1) {
				// org-hide-leading-stars: only the last star shows; widths don't change.
				builder.add(from, to - 1, mark('cm-org-stars cm-org-lead'));
				builder.add(to - 1, to, mark('cm-org-stars'));
			} else if (live && span.kind === 'keyword' && !lineActive && /^#\+title:/i.test(l.text)) {
				hide(from, Math.min(l.to, to + (/^[ \t]*/.exec(l.text.slice(span.to))?.[0].length ?? 0)));
			} else if (
				live &&
				span.kind === 'bullet' &&
				/^[-+]$/.test(l.text.slice(span.from, span.to)) &&
				!touched(from, to + 1)
			) {
				hide(from, to, bullet);
			} else if (live && span.kind === 'checkbox' && !touched(from, to)) {
				hide(from, to, checkbox(span.data ?? ' '));
			} else if (span.kind === 'link-markup' && !open(from)) {
				hide(from, to);
			} else if (span.kind === 'link')
				builder.add(
					from,
					to,
					mark('cm-org-link', {
						'data-target': span.data ?? '',
						title: `${span.data} — ⌘/Ctrl-click to open`,
					}),
				);
			else builder.add(from, to, mark(spanClass(span)));
		}
	}
	return { all: builder.finish(), hidden: hiddenBuilder.finish() };
}

function orgHighlight(hooks: EditorHooks): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			hidden: DecorationSet;
			constructor(view: EditorView) {
				({ all: this.decorations, hidden: this.hidden } = build(
					view,
					hooks.keywords(),
					hooks.livePreview?.() ?? true,
				));
			}
			update(u: ViewUpdate) {
				if (
					u.docChanged ||
					u.viewportChanged ||
					u.selectionSet ||
					u.transactions.some((t) => t.effects.some((e) => e.is(redecorate)))
				)
					({ all: this.decorations, hidden: this.hidden } = build(
						u.view,
						hooks.keywords(),
						hooks.livePreview?.() ?? true,
					));
			}
		},
		{
			decorations: (v) => v.decorations,
			// Folded link markup is skipped as a unit by the cursor.
			provide: (p) =>
				EditorView.atomicRanges.of((view) => view.plugin(p)?.hidden ?? Decoration.none),
		},
	);
}

/** Offer nodes after `[[`; the last option creates a new node with the typed title. */
function linkCompletion(hooks: EditorHooks) {
	return (ctx: CompletionContext): CompletionResult | null => {
		const before = ctx.matchBefore(/\[\[(?!id:)[^[\]\n]*$/);
		if (!before) return null;
		const query = before.text.slice(2);
		const title = query.replace(/\s+/g, ' ').trim();
		const from = before.from;
		// Swallow the brackets closeBrackets added after the cursor.
		const to =
			ctx.pos + (/^\]{0,2}/.exec(ctx.state.sliceDoc(ctx.pos, ctx.pos + 2))?.[0].length ?? 0);
		const insert = (view: EditorView, id: string, name: string) => {
			const text = `[[id:${id}][${name}]]`;
			view.dispatch({
				changes: { from, to, insert: text },
				selection: { anchor: from + text.length },
			});
		};
		const ranked: { rank: number; option: Completion }[] = [];
		let exact = false;
		for (const node of hooks.nodes()) {
			for (const name of [node.title, ...node.aliases]) {
				const rank = matchRank(name, title);
				if (rank === null) continue;
				if (rank === 0) exact = true;
				const detail = name === node.title ? node.olp.join(' › ') : `alias of ${node.title}`;
				ranked.push({
					rank,
					option: {
						label: name,
						...(detail ? { detail } : {}),
						type: node.level === 0 ? 'class' : 'property',
						apply: (view) => insert(view, node.id, name),
					},
				});
			}
		}
		ranked.sort(
			(a, b) =>
				a.rank - b.rank ||
				a.option.label.length - b.option.label.length ||
				a.option.label.localeCompare(b.option.label),
		);
		const options = ranked.slice(0, 40).map((r) => r.option);
		if (title && !exact)
			options.push({
				label: `Create “${title}”`,
				detail: 'new note',
				type: 'keyword',
				apply: (view) => {
					const id = hooks.createNode(title);
					if (id) insert(view, id, title);
				},
			});
		if (!options.length) return null;
		return { from: from + 2, to: ctx.pos, options, filter: false };
	};
}

/** `M-RET`: a new heading at the current level (or a list item inside a list). */
function newHeading(view: EditorView): boolean {
	const { state } = view;
	const pos = state.selection.main.head;
	const current = state.doc.lineAt(pos);
	let level = 1;
	for (let n = current.number; n >= 1; n--) {
		const m = /^(\*+)[ \t]/.exec(state.doc.line(n).text);
		if (m) {
			level = m[1]!.length;
			break;
		}
	}
	const item = /^([ \t]*)([-+]|\d+[.)])[ \t]+(\[[ Xx-]\][ \t]+)?/.exec(current.text);
	const insert = item
		? `\n${item[1]}${/\d/.test(item[2]!) ? `${Number.parseInt(item[2]!, 10) + 1}${item[2]!.slice(-1)}` : item[2]} ${item[3] ? '[ ] ' : ''}`
		: `\n${'*'.repeat(level)} `;
	view.dispatch({
		changes: { from: current.to, insert },
		selection: { anchor: current.to + insert.length },
		scrollIntoView: true,
	});
	return true;
}

const theme = EditorView.theme({
	'&': {
		minHeight: '60vh',
		color: 'var(--text)',
		backgroundColor: 'transparent',
		fontSize: '0.95rem',
		// The mono font's ligatures would draw `***` and `->` as single glyphs.
		fontVariantLigatures: 'none',
	},
	'&.cm-focused': { outline: 'none' },
	// A folded heading's “…”: tap it to open.
	'.cm-org-fold': {
		margin: '0 0.3em',
		padding: '0 0.45em',
		border: '1px solid var(--border)',
		borderRadius: '6px',
		background: 'var(--surface-2)',
		color: 'var(--text-muted)',
		font: 'inherit',
		lineHeight: '1.2',
		cursor: 'pointer',
	},
	'.cm-scroller': { fontFamily: 'var(--font-read)', fontSize: '1.08rem', lineHeight: '1.7' },
	'.cm-org-l-block, .cm-org-l-block-delim, .cm-org-l-drawer, .cm-org-l-meta, .cm-org-l-table, .cm-org-l-planning, .cm-org-l-comment':
		{ fontFamily: 'var(--font-mono)', fontSize: '0.8em' },
	'.cm-org-code, .cm-org-timestamp, .cm-org-tags, .cm-org-checkbox, .cm-org-cookie': {
		fontFamily: 'var(--font-mono)',
		fontSize: '0.85em',
	},
	'.cm-content': { caretColor: 'var(--accent)', padding: '0.5rem 0 40vh' },
	// iOS zooms the page into any focused text under 16px.
	'@media (pointer: coarse)': { '.cm-scroller': { fontSize: 'max(16px, 1.08rem)' } },
	'.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
	'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
		backgroundColor: 'color-mix(in oklab, var(--accent) 22%, transparent) !important',
	},
	'.cm-selectionMatch': { backgroundColor: 'color-mix(in oklab, var(--accent) 12%, transparent)' },
	'.cm-tooltip': {
		border: '1px solid var(--border)',
		borderRadius: '10px',
		background: 'var(--surface)',
		boxShadow: 'var(--shadow-lg)',
		overflow: 'hidden',
	},
	'.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-ui)', maxHeight: '18rem' },
	'.cm-tooltip-autocomplete > ul > li': { padding: '0.3rem 0.7rem !important' },
	'.cm-tooltip-autocomplete > ul > li[aria-selected]': {
		background: 'var(--accent-soft)',
		color: 'var(--text)',
	},
	'.cm-completionDetail': {
		marginLeft: '0.6rem',
		color: 'var(--text-muted)',
		fontStyle: 'normal',
		fontSize: '0.8em',
	},
	'.cm-completionMatchedText': {
		textDecoration: 'none',
		fontWeight: '700',
		color: 'var(--accent)',
	},
	'.cm-panels': {
		background: 'var(--surface-2)',
		color: 'var(--text)',
		borderColor: 'var(--border)',
	},
	'.cm-org-h': { fontFamily: 'var(--font-read)', fontWeight: '650', color: 'var(--text)' },
	// Close to body size while editing: weight and the stars show the outline;
	// reading view keeps the big headings.
	'.cm-org-h1': { fontSize: '1.15em' },
	'.cm-org-h2': { fontSize: '1.08em' },
	'.cm-org-h3': { fontSize: '1.03em' },
	'.cm-org-stars': {
		color: 'var(--text-faint)',
		fontFamily: 'var(--font-mono)',
		fontWeight: '400',
	},
	'.cm-org-todo': {
		color: 'var(--todo)',
		fontFamily: 'var(--font-ui)',
		fontSize: '0.8em',
		fontWeight: '700',
		letterSpacing: '0.05em',
	},
	'.cm-org-done': {
		color: 'var(--done)',
		fontFamily: 'var(--font-ui)',
		fontSize: '0.8em',
		fontWeight: '700',
		letterSpacing: '0.05em',
	},
	'.cm-org-priority': { color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '0.8em' },
	'.cm-org-tags': {
		color: 'var(--text-muted)',
		fontFamily: 'var(--font-mono)',
		fontSize: '0.75em',
		fontWeight: '400',
	},
	'.cm-org-keyword, .cm-org-drawer, .cm-org-block-delim, .cm-org-property, .cm-org-planning, .cm-org-markup, .cm-org-table':
		{ color: 'var(--text-faint)' },
	'.cm-org-title': { fontFamily: 'var(--font-read)', fontSize: '1.15em', fontWeight: '600' },
	'.cm-org-l-block': { background: 'var(--surface-2)' },
	'.cm-org-l-drawer, .cm-org-l-planning': { fontSize: '0.85em' },
	'.cm-org-comment': { color: 'var(--text-muted)', fontStyle: 'italic' },
	'.cm-org-timestamp': { color: 'var(--next)' },
	'.cm-mention': {
		textDecoration: 'underline dotted',
		textDecorationColor: 'color-mix(in oklab, var(--link) 45%, transparent)',
		textDecorationThickness: '1.5px',
		textUnderlineOffset: '0.22em',
	},
	'.cm-org-link': {
		color: 'var(--link)',
		textDecoration: 'underline',
		textDecorationThickness: '1px',
		textUnderlineOffset: '3px',
		cursor: 'pointer',
	},
	'.cm-org-bold': { fontWeight: '700' },
	'.cm-org-italic': { fontStyle: 'italic' },
	'.cm-org-underline': { textDecoration: 'underline' },
	'.cm-org-strike': { textDecoration: 'line-through' },
	'.cm-org-code': {
		color: 'var(--accent-strong)',
		background: 'var(--surface-2)',
		borderRadius: '3px',
	},
	'.cm-org-bullet': { color: 'var(--accent)', fontWeight: '700' },
	'.cm-org-lead': { color: 'transparent' },
	'.cm-org-dot': { color: 'var(--accent)', fontWeight: '700', padding: '0 0.08em' },
	'.cm-org-box': {
		width: '0.95em',
		height: '0.95em',
		margin: '0 0.2em 0 0',
		verticalAlign: '-0.12em',
		accentColor: 'var(--accent)',
		cursor: 'pointer',
	},
	'.cm-org-checkbox': { color: 'var(--todo)', fontWeight: '700' },
	'.cm-org-checkbox.checked': { color: 'var(--done)' },
	'.cm-org-cookie': { color: 'var(--text-muted)', fontSize: '0.85em' },
});

/** Link suggestions underlined in the text (faint), kept up to date as it changes. */
function mentionMarks(hooks: EditorHooks) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			found: EditorMention[] = [];
			constructor(view: EditorView) {
				this.decorations = this.build(view);
			}
			update(u: ViewUpdate) {
				if (u.docChanged) this.decorations = this.build(u.view);
			}
			build(view: EditorView): DecorationSet {
				this.found = hooks.mentions?.(view.state.doc.toString()) ?? [];
				const builder = new RangeSetBuilder<Decoration>();
				for (const m of this.found)
					builder.add(
						m.from,
						m.to,
						Decoration.mark({
							class: 'cm-mention',
							attributes: { title: `${m.title}: Ctrl/⌘-. to link` },
						}),
					);
				return builder.finish();
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

/**
 * Link here (Mod-.): the suggestion under the cursor becomes a link; selected
 * words open Link to… and keep their wording; otherwise Link to… inserts a
 * link to the chosen note at the cursor.
 */
export function linkHere(hooks: EditorHooks, plugin: ReturnType<typeof mentionMarks>) {
	return (view: EditorView): boolean => {
		const sel = view.state.selection.main;
		const replace = (from: number, to: number, insert: string) => {
			view.dispatch({
				changes: { from, to, insert },
				selection: { anchor: from + insert.length },
				scrollIntoView: true,
				userEvent: 'input',
			});
			view.focus();
		};
		if (sel.empty) {
			const m = view.plugin(plugin)?.found.find((x) => x.from <= sel.head && sel.head <= x.to);
			if (m) {
				replace(m.from, m.to, `[[id:${m.id}][${m.text}]]`);
				return true;
			}
		}
		if (!hooks.linkTo) return false;
		const words = sel.empty ? null : view.state.sliceDoc(sel.from, sel.to).replace(/\s+/g, ' ');
		const { from, to } = sel;
		hooks.linkTo(words, (id, title) => replace(from, to, `[[id:${id}][${words ?? title}]]`));
		return true;
	};
}

/**
 * Create the editor. Mount it in a shadow root: CodeMirror then styles itself
 * with constructable stylesheets, which the site's CSP allows, instead of
 * inline `<style>` tags, which it doesn't.
 */
export function createEditor(
	root: ShadowRoot,
	doc: string,
	hooks: EditorHooks,
	label: string,
): EditorView {
	const parent = document.createElement('div');
	root.append(parent);
	const mentions = mentionMarks(hooks);
	const link = linkHere(hooks, mentions);
	const view = new EditorView({
		parent,
		root,
		state: EditorState.create({
			doc,
			extensions: [
				history(),
				drawSelection(),
				closeBrackets(),
				search({ top: true }),
				highlightSelectionMatches(),
				EditorView.lineWrapping,
				EditorView.contentAttributes.of({
					'aria-label': label,
					spellcheck: 'true',
					autocapitalize: 'sentences',
				}),
				autocompletion({ override: [linkCompletion(hooks), texCompletion], icons: false }),
				texSupport(() => hooks.livePreview?.() ?? true),
				keymap.of([
					{ key: 'Alt-Enter', run: newHeading },
					{ key: 'Mod-.', run: link },
					// Inside a table, org's table keys come first.
					{ key: 'Enter', run: (v) => table.nextRow(v) || continueList(v) },
					// Org's TAB and S-TAB: in a table, its fields; on a heading, folding
					// (Alt-arrows demote and promote); in a list, its items.
					{
						key: 'Tab',
						run: (v) => table.nextField(v) || cycleHeading(v) || indentItem(v),
					},
					{
						key: 'Shift-Tab',
						run: (v) => table.previousField(v) || outdentListItem(v) || cycleOutlineCommand(v),
					},
					{ key: 'Alt-ArrowRight', run: (v) => table.moveColumnRight(v) || indentItem(v) },
					{ key: 'Alt-ArrowLeft', run: (v) => table.moveColumnLeft(v) || outdentItem(v) },
					{ key: 'Alt-ArrowUp', run: table.moveRowUp },
					{ key: 'Alt-ArrowDown', run: table.moveRowDown },
					{ key: 'Alt-Shift-ArrowDown', run: table.insertRowAbove },
					{ key: 'Alt-Shift-ArrowUp', run: table.deleteThisRow },
					{ key: 'Alt-Shift-ArrowRight', run: table.insertColumnHere },
					{ key: 'Alt-Shift-ArrowLeft', run: table.deleteThisColumn },
					{ key: 'Ctrl-c Ctrl-c', run: toggleItemCheckbox },
					...closeBracketsKeymap,
					...completionKeymap,
					...searchKeymap,
					...historyKeymap,
					...defaultKeymap,
					indentWithTab,
				]),
				folding,
				orgHighlight(hooks),
				mentions,
				EditorView.domEventHandlers({
					// Pictures pasted or dropped into a note are saved to the vault (via the picture sheet).
					paste(e, view) {
						const file = [...(e.clipboardData?.files ?? [])].find((f) =>
							f.type.startsWith('image/'),
						);
						if (file && hooks.onImage) {
							e.preventDefault();
							hooks.onImage(file, view.state.selection.main.head);
							return true;
						}
						// A note's source URL: pasted as is, then the note's link is offered.
						const raw = e.clipboardData?.getData('text/plain') ?? '';
						const url = raw.trim();
						const note = /^[a-z][a-z0-9+.-]*:\S+$/i.test(url) ? hooks.refFor?.(url) : null;
						if (note && hooks.onRefPaste) {
							const from = view.state.selection.main.from + raw.indexOf(url);
							queueMicrotask(() => {
								const to = from + url.length;
								if (view.state.sliceDoc(from, to) === url)
									hooks.onRefPaste!({ from, to, url, ...note });
							});
						}
						return false;
					},
					drop(e, view) {
						const file = [...(e.dataTransfer?.files ?? [])].find((f) =>
							f.type.startsWith('image/'),
						);
						if (!file || !hooks.onImage) return false;
						e.preventDefault();
						const pos =
							view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
						hooks.onImage(file, pos);
						return true;
					},
					mousedown(e) {
						const el = (e.target as HTMLElement).closest<HTMLElement>('.cm-org-link');
						if (el && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							hooks.follow(el.dataset.target ?? '', e.altKey);
							return true;
						}
						return false;
					},
				}),
				EditorView.updateListener.of((u) => {
					if (u.docChanged && !u.transactions.some((t) => t.annotation(external)))
						hooks.onChange(u.state.doc.toString());
					if (u.docChanged || u.selectionSet || u.focusChanged) hooks.onCursor?.(u.view);
				}),
				// Keep the cursor clear of the formatting bar floating above the keyboard.
				EditorView.scrollMargins.of(() => ({ bottom: 64 })),
				theme,
			],
		}),
	});
	linkCommands.set(view, link);
	return view;
}

const linkCommands = new WeakMap<EditorView, (view: EditorView) => boolean>();

/** Link here, as Ctrl/⌘-. does (the formatting bar's link button). */
export function linkAtCursor(view: EditorView): boolean {
	return linkCommands.get(view)?.(view) ?? false;
}

/** Replace the editor's text with `text`, touching only the changed middle so the cursor stays put. */
export function syncEditor(view: EditorView, text: string) {
	const current = view.state.doc.toString();
	if (current === text) return;
	let start = 0;
	const max = Math.min(current.length, text.length);
	while (start < max && current.charCodeAt(start) === text.charCodeAt(start)) start++;
	let end = 0;
	while (
		end < max - start &&
		current.charCodeAt(current.length - 1 - end) === text.charCodeAt(text.length - 1 - end)
	)
		end++;
	view.dispatch({
		changes: {
			from: start,
			to: current.length - end,
			insert: text.slice(start, text.length - end),
		},
		annotations: external.of(true),
	});
}
