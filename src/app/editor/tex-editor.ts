/// LaTeX help in the source editor: the formula under the cursor is
/// previewed just below its line (or the problem with it explained),
/// fragments KaTeX can't typeset get a wavy underline with the reason, and
/// typing `\` inside maths offers commands and snippets. KaTeX loads only
/// once a note has maths in it; the preview uses MathML, which browsers
/// draw themselves (the editor lives in a shadow root, beyond the page's CSS).

import {
	snippetCompletion,
	type Completion,
	type CompletionContext,
	type CompletionResult,
} from '@codemirror/autocomplete';
import {
	RangeSetBuilder,
	StateEffect,
	StateField,
	type EditorState,
	type Extension,
} from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';
import { checkTex, fragmentAt, fragmentsIn, inMath, TEX_GROUPS, type TexProblem } from './tex';

type Katex = typeof import('katex').default;
let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;

/** Tells the editor KaTeX has arrived, so previews and marks can be drawn. */
const texReady = StateEffect.define<null>();

const MAYBE_MATH = /\\\(|\\\[|\$/;

/** Results by formula, so retyping elsewhere doesn't re-run KaTeX. */
const cache = new Map<string, { html: string } | { problem: TexProblem }>();
function check(tex: string, display: boolean) {
	const key = `${display ? 'D' : 'I'}${tex}`;
	let r = cache.get(key);
	if (!r && katex) {
		r = checkTex(katex, tex, display);
		const mathml = 'html' in r ? { html: mathmlOnly(tex, display) } : r;
		if (cache.size > 500) cache.clear();
		cache.set(key, mathml);
		r = mathml;
	}
	return r ?? null;
}
function mathmlOnly(tex: string, display: boolean): string {
	return katex!.renderToString(tex, {
		displayMode: display,
		throwOnError: false,
		strict: 'ignore',
		trust: false,
		maxExpand: 500,
		output: 'mathml',
	});
}

class Preview extends WidgetType {
	constructor(
		readonly key: string,
		readonly html: string | null,
		readonly problem: string | null,
	) {
		super();
	}
	override eq(other: Preview) {
		return other.key === this.key;
	}
	toDOM() {
		const el = document.createElement('div');
		el.className = this.problem ? 'cm-tex-preview cm-tex-problem' : 'cm-tex-preview';
		el.setAttribute('aria-live', 'polite');
		// KaTeX's own output (trust: false), or plain text.
		if (this.html) el.innerHTML = this.html;
		else el.textContent = this.problem ?? '';
		return el;
	}
	override ignoreEvent() {
		return true;
	}
}

/** The preview widget for the formula at the cursor (block widgets need a state field). */
function previewFor(state: EditorState): DecorationSet {
	if (!katex) return Decoration.none;
	const sel = state.selection.main;
	if (!sel.empty) return Decoration.none;
	const line = state.doc.lineAt(sel.head);
	const frag = fragmentAt(line.text, sel.head - line.from);
	if (!frag || !frag.tex.trim()) return Decoration.none;
	const r = check(frag.tex, frag.display);
	if (!r) return Decoration.none;
	const widget =
		'html' in r
			? new Preview(`${frag.display}${frag.tex}`, r.html, null)
			: new Preview(`${frag.display}${frag.tex}!`, null, r.problem.message);
	return Decoration.set([Decoration.widget({ widget, block: true, side: 1 }).range(line.to)]);
}

const previewField = StateField.define<DecorationSet>({
	create: (state) => previewFor(state),
	update(value, tr) {
		if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(texReady)))
			return previewFor(tr.state);
		return value;
	},
	provide: (f) => EditorView.decorations.from(f),
});

/** Maths reads as code: the mono font, and no spell-checking of `\frac`. */
const texMark = Decoration.mark({ class: 'cm-tex', attributes: { spellcheck: 'false' } });

const errorMarks = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet = Decoration.none;
		constructor(view: EditorView) {
			this.load(view);
			this.decorations = this.build(view);
		}
		update(u: ViewUpdate) {
			if (u.docChanged) this.load(u.view);
			if (
				u.docChanged ||
				u.viewportChanged ||
				u.transactions.some((t) => t.effects.some((e) => e.is(texReady)))
			)
				this.decorations = this.build(u.view);
		}
		/** Fetch KaTeX the first time the note shows signs of maths. */
		load(view: EditorView) {
			if (katex || loading) return;
			const { from, to } = view.viewport;
			if (!MAYBE_MATH.test(view.state.sliceDoc(from, to))) return;
			loading = import('katex').then((m) => (katex = m.default));
			// A failed download (offline, or a deploy in between) is retried next time.
			loading.then(
				() => view.dispatch({ effects: texReady.of(null) }),
				() => (loading = null),
			);
		}
		build(view: EditorView): DecorationSet {
			if (!katex) return Decoration.none;
			const b = new RangeSetBuilder<Decoration>();
			for (const { from, to } of view.visibleRanges) {
				for (let pos = from; pos <= to;) {
					const line = view.state.doc.lineAt(pos);
					if (MAYBE_MATH.test(line.text))
						for (const f of fragmentsIn(line.text)) {
							const r = check(f.tex, f.display);
							b.add(
								line.from + f.from,
								line.from + f.to,
								r && 'problem' in r
									? Decoration.mark({
											class: 'cm-tex cm-tex-error',
											attributes: { title: r.problem.message, spellcheck: 'false' },
										})
									: texMark,
							);
						}
					pos = line.to + 1;
				}
			}
			return b.finish();
		}
	},
	{ decorations: (v) => v.decorations },
);

/** `\` inside maths: LaTeX commands and the palette's snippets. */
const OPTIONS: Completion[] = TEX_GROUPS.flatMap((g) =>
	g.items.map((s) => {
		const name = /^\\[a-zA-Z]+/.exec(s.tex)?.[0];
		const option: Completion = {
			label: name ?? s.tex,
			detail: `${s.show}  ${s.label}`,
			type: 'function',
		};
		return s.tex.includes('${') ? snippetCompletion(s.tex, option) : { ...option, apply: s.tex };
	}),
).filter((o) => o.label.startsWith('\\'));

export function texCompletion(ctx: CompletionContext): CompletionResult | null {
	const word = ctx.matchBefore(/\\[a-zA-Z]*$/);
	if (!word) return null;
	const line = ctx.state.doc.lineAt(ctx.pos);
	if (!inMath(line.text, ctx.pos - line.from)) return null;
	return { from: word.from, options: OPTIONS, validFor: /^\\[a-zA-Z]*$/ };
}

export const texTheme = EditorView.theme({
	'.cm-tex-preview': {
		margin: '0.15rem 0 0.4rem',
		padding: '0.45rem 0.7rem',
		border: '1px dashed var(--border)',
		borderRadius: '8px',
		background: 'var(--surface)',
		fontSize: '1.15em',
		overflowX: 'auto',
	},
	'.cm-tex-problem': {
		borderColor: 'var(--todo)',
		color: 'var(--todo)',
		fontFamily: 'var(--font-ui)',
		fontSize: '0.85em',
	},
	'.cm-tex': { fontFamily: 'var(--font-mono)', fontSize: '0.88em' },
	'.cm-tex-error': {
		textDecoration: 'underline wavy var(--todo)',
		textDecorationSkipInk: 'none',
		textUnderlineOffset: '3px',
	},
});

export const texSupport: Extension = [previewField, errorMarks, texTheme];
