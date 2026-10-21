/// Syntax highlighting for source blocks, with the language grammars the
/// editor uses (CodeMirror's language data, each loaded on first use).

import type { Action } from 'svelte/action';

/** Org's names for languages (`#+begin_src emacs-lisp`) → CodeMirror's. */
const ALIASES: Record<string, string> = {
	'emacs-lisp': 'common lisp',
	elisp: 'common lisp',
	lisp: 'common lisp',
	sh: 'shell',
	bash: 'shell',
	zsh: 'shell',
	shell: 'shell',
	js: 'javascript',
	ts: 'typescript',
	py: 'python',
	ipython: 'python',
	jupyter: 'python',
	c: 'c',
	cpp: 'c++',
	'c++': 'c++',
	cc: 'c++',
	r: 'r',
	md: 'markdown',
	yml: 'yaml',
	conf: 'properties',
	ini: 'properties',
	dot: 'dot',
	latex: 'latex',
	tex: 'latex',
};

export type Token = { text: string; cls: string };

/** Highlighted tokens for `code` in `lang`, or `null` for an unknown language. */
export async function highlight(code: string, lang: string): Promise<Token[] | null> {
	const [{ languages }, { LanguageDescription }, { highlightCode, classHighlighter }] =
		await Promise.all([
			import('@codemirror/language-data'),
			import('@codemirror/language'),
			import('@lezer/highlight'),
		]);
	const name = ALIASES[lang.toLowerCase()] ?? lang;
	const desc = LanguageDescription.matchLanguageName(languages, name, true);
	if (!desc) return null;
	const support = await desc.load();
	const tree = support.language.parser.parse(code);
	const out: Token[] = [];
	highlightCode(
		code,
		tree,
		classHighlighter,
		(text, cls) => out.push({ text, cls }),
		() => out.push({ text: '\n', cls: '' }),
	);
	return out;
}

/** Replace the element's text with highlighted spans (it keeps the plain text otherwise). */
export const highlighted: Action<HTMLElement, { code: string; lang: string | null }> = (
	node,
	value,
) => {
	let current = value;
	let run = 0;
	const render = async () => {
		const mine = ++run;
		node.textContent = current.code;
		if (!current.lang) return;
		const tokens = await highlight(current.code, current.lang).catch(() => null);
		if (!tokens || mine !== run || !node.isConnected) return;
		const frag = document.createDocumentFragment();
		for (const t of tokens) {
			if (!t.cls) frag.append(t.text);
			else {
				const span = document.createElement('span');
				span.className = t.cls;
				span.textContent = t.text;
				frag.append(span);
			}
		}
		node.replaceChildren(frag);
	};
	void render();
	return {
		update(next) {
			current = next;
			void render();
		},
	};
};
