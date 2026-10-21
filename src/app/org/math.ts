/// LaTeX in notes, typeset with KaTeX (loaded only when a note has maths).
///
/// Org's fragments keep their delimiters in the parse tree: `$x$`, `$$x$$`,
/// `\(x\)`, `\[x\]`, or a whole `\begin{env}…\end{env}`. Anything KaTeX can't
/// typeset stays as the source, as Emacs shows it without a preview.

import type { Action } from 'svelte/action';
// The stylesheet ships with the app (a lazily imported stylesheet isn't
// emitted by the build); its fonts download only when maths is shown.
import 'katex/dist/katex.min.css';

export interface Tex {
	tex: string;
	display: boolean;
}

/** What the action shows: the source until (or unless) KaTeX typesets it. */
export interface MathInput extends Tex {
	source: string;
}

/** The maths inside a fragment's delimiters, or `null` for a non-maths fragment (`\foo{…}`). */
export function texOf(fragment: string): Tex | null {
	const v = fragment.trim();
	if (v.startsWith('$$') && v.endsWith('$$') && v.length >= 4)
		return { tex: v.slice(2, -2), display: true };
	if (v.startsWith('\\[') && v.endsWith('\\]')) return { tex: v.slice(2, -2), display: true };
	if (v.startsWith('\\(') && v.endsWith('\\)')) return { tex: v.slice(2, -2), display: false };
	if (v.startsWith('$') && v.endsWith('$') && v.length >= 2)
		return { tex: v.slice(1, -1), display: false };
	if (/^\\begin\{/.test(v)) return { tex: v, display: true };
	return null;
}

let katex: Promise<typeof import('katex').default> | null = null;
function load() {
	katex ??= import('katex').then(
		(m) => m.default,
		(e) => {
			katex = null; // try again next time
			throw e;
		},
	);
	return katex;
}

/** Typeset `tex` into the element; on failure the element keeps its text. */
export const math: Action<HTMLElement, MathInput> = (node, value) => {
	let current = value;
	const render = async () => {
		const fallback = document.createElement('code');
		fallback.className = 'latex';
		fallback.textContent = current.source;
		node.replaceChildren(fallback);
		node.classList.remove('typeset');
		const k = await load().catch(() => null);
		if (!k || !node.isConnected) return;
		try {
			k.render(current.tex, node, {
				displayMode: current.display,
				throwOnError: true,
				strict: 'ignore',
				trust: false,
				maxExpand: 500,
				output: 'htmlAndMathml',
			});
			node.classList.add('typeset');
		} catch {
			/* not something KaTeX understands: leave the source showing */
		}
	};
	void render();
	return {
		update(next) {
			current = next;
			void render();
		},
	};
};
