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
import { continueList, indentItem, outdentItem, toggleItemCheckbox } from './list-commands';
import * as table from './table-commands';
import { texCompletion, texSupport } from './tex-editor';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Annotation, EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
	Decoration,
	drawSelection,
	EditorView,
	keymap,
	ViewPlugin,
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
	follow: (target: string) => void;
	onChange: (text: string) => void;
	/** A picture was pasted or dropped at `pos`. */
	onImage?: (file: File, pos: number) => void;
	/** Focus moved in or out, or the cursor moved (for the formatting bar). */
	onCursor?: (view: EditorView) => void;
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

function build(
	view: EditorView,
	keywords: KeywordConfig,
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
		for (const span of info.spans) {
			if (span.from === span.to) continue;
			const from = l.from + span.from;
			const to = l.from + span.to;
			if (span.kind === 'link-markup' && !open(from)) {
				builder.add(from, to, hidden);
				hiddenBuilder.add(from, to, hidden);
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
				({ all: this.decorations, hidden: this.hidden } = build(view, hooks.keywords()));
			}
			update(u: ViewUpdate) {
				if (u.docChanged || u.viewportChanged || u.selectionSet)
					({ all: this.decorations, hidden: this.hidden } = build(u.view, hooks.keywords()));
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

/** How well `label` matches `query` (lower is better), or null for no match. */
export function matchRank(label: string, query: string): number | null {
	const l = label.toLowerCase();
	const q = query.toLowerCase();
	if (!q) return 4;
	if (l === q) return 0;
	if (l.startsWith(q)) return 1;
	const at = l.indexOf(q);
	if (at > 0 && /[\s\-_/(]/.test(l[at - 1]!)) return 2;
	if (at > 0) return 3;
	let i = 0;
	for (const ch of l) if (ch === q[i]) i++;
	return i === q.length ? 5 : null;
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
	'.cm-org-checkbox': { color: 'var(--todo)', fontWeight: '700' },
	'.cm-org-checkbox.checked': { color: 'var(--done)' },
	'.cm-org-cookie': { color: 'var(--text-muted)', fontSize: '0.85em' },
});

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
	return new EditorView({
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
				texSupport,
				keymap.of([
					{ key: 'Alt-Enter', run: newHeading },
					// Inside a table, org's table keys come first.
					{ key: 'Enter', run: (v) => table.nextRow(v) || continueList(v) },
					{ key: 'Tab', run: (v) => table.nextField(v) || indentItem(v) },
					{ key: 'Shift-Tab', run: (v) => table.previousField(v) || outdentItem(v) },
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
				orgHighlight(hooks),
				EditorView.domEventHandlers({
					// Pictures pasted or dropped into a note are saved to the vault (via the picture sheet).
					paste(e, view) {
						const file = [...(e.clipboardData?.files ?? [])].find((f) =>
							f.type.startsWith('image/'),
						);
						if (!file || !hooks.onImage) return false;
						e.preventDefault();
						hooks.onImage(file, view.state.selection.main.head);
						return true;
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
							hooks.follow(el.dataset.target ?? '');
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
