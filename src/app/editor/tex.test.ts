import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { checkTex, expandSnippet, fragmentAt, fragmentsIn, inMath, TEX_GROUPS } from './tex';

describe('finding maths on a line', () => {
	it('reads org fragment delimiters', () => {
		const tex = (l: string) => fragmentsIn(l).map((f) => [f.tex, f.display]);
		expect(tex('a \\(x^2\\) b \\[y\\] c')).toEqual([
			['x^2', false],
			['y', true],
		]);
		expect(tex('$$E=mc^2$$ and $a+b$, $c$.')).toEqual([
			['E=mc^2', true],
			['a+b', false],
			['c', false],
		]);
	});
	it("doesn't take prices or loose dollars for maths", () => {
		expect(fragmentsIn('costs $5 and $10')).toEqual([]);
		expect(fragmentsIn('a $ b $ c')).toEqual([]);
		expect(fragmentsIn('x$y$z')).toEqual([]);
	});
	it('finds the fragment at the cursor, or maths still being typed', () => {
		expect(fragmentAt('see \\(a+b\\) here', 7)?.tex).toBe('a+b');
		expect(fragmentAt('see \\(a+b\\) here', 1)).toBeNull();
		expect(inMath('energy \\(E = \\fr', 16)).toBe(true);
		expect(inMath('cost $x + \\al', 13)).toBe(true);
		expect(inMath('plain \\text', 11)).toBe(false);
	});
});

describe('checking maths', () => {
	const problem = (tex: string) => {
		const r = checkTex(katex, tex, false);
		return 'problem' in r ? r.problem : null;
	};
	it('typesets good maths', () => {
		expect('html' in checkTex(katex, '\\frac{a}{b}', false)).toBe(true);
	});
	it('explains common mistakes in plain words, with where', () => {
		expect(problem('\\frac{a}{b')?.message).toMatch(/never closed/);
		expect(problem('\\alhpa')?.message).toMatch(/\\alhpa isn't a command/);
		expect(problem('x^')).toEqual({ message: expect.stringMatching(/Nothing follows \^/), at: 1 });
		expect(problem('a & b')?.message).toMatch(/only works inside a matrix/);
		expect(problem('\\left( x')?.message).toMatch(/\\right/);
		expect(problem('\\sqrt')?.message).toMatch(/\\sqrt needs something/);
		expect(problem('\\begin{pmatrix} a')?.message).toMatch(/\\end/);
		expect(problem('x}')?.message).toMatch(/no \{ before it/);
	});
});

describe('palette snippets', () => {
	it('all typeset with KaTeX once filled in', () => {
		for (const group of TEX_GROUPS)
			for (const s of group.items) {
				const { text } = expandSnippet(s.tex);
				const r = checkTex(katex, `x ${text.replace(/\{\}/g, '{y}')} y`, false);
				expect('problem' in r ? `${s.label}: ${r.problem.message}` : 'ok').toBe('ok');
			}
	});
	it('expand with the first placeholder selected', () => {
		expect(expandSnippet('\\frac{${a}}{${b}}')).toEqual({ text: '\\frac{a}{b}', select: [6, 7] });
		expect(expandSnippet('\\alpha')).toEqual({ text: '\\alpha', select: null });
	});
});
