/// LaTeX helpers for the editor and the maths sheet: where the maths is on a
/// line (org's fragment syntax), what KaTeX's errors mean in plain words,
/// and the snippets behind the palette and `\command` completion.

/** A LaTeX fragment on a line: offsets of the whole fragment, and its maths. */
export interface Fragment {
	from: number;
	to: number;
	tex: string;
	display: boolean;
}

/**
 * The LaTeX fragments on a line, as org reads them: `\(…\)`, `\[…\]`,
 * `$$…$$`, and `$…$` when the dollars hug the maths (no space just inside)
 * and the closing one isn't followed by a word character
 * (`org-element-latex-fragment-parser`).
 */
export function fragmentsIn(line: string): Fragment[] {
	const out: Fragment[] = [];
	const re =
		/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]+?)\$\$|(?<![$\w])\$(?![\s$])((?:[^$\\]|\\.)*?[^\s\\$])\$(?![\w$])|(?<![$\w])\$([^\s$\\.,;:!?'"()])\$(?![\w$])/g;
	for (const m of line.matchAll(re)) {
		const tex = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
		out.push({
			from: m.index,
			to: m.index + m[0].length,
			tex,
			display: m[2] !== undefined || m[3] !== undefined,
		});
	}
	return out;
}

/** The fragment holding column `at` (its delimiters included), if any. */
export function fragmentAt(line: string, at: number): Fragment | null {
	return fragmentsIn(line).find((f) => at >= f.from && at <= f.to) ?? null;
}

/**
 * Is column `at` inside maths that's still being typed? An unclosed `\(`
 * or `\[` before it, or an odd number of `$` (for completion while the
 * closing delimiter isn't there yet).
 */
export function inMath(line: string, at: number): boolean {
	if (fragmentAt(line, at)) return true;
	const before = line.slice(0, at);
	const open = Math.max(before.lastIndexOf('\\('), before.lastIndexOf('\\['));
	const close = Math.max(before.lastIndexOf('\\)'), before.lastIndexOf('\\]'));
	if (open > close) return true;
	return (before.replace(/\\\$/g, '').match(/\$/g)?.length ?? 0) % 2 === 1;
}

/** KaTeX's error, in plain words, with where it went wrong (an offset into the maths). */
export interface TexProblem {
	message: string;
	at: number | null;
}

export function explainTexError(raw: string, at: number | null): TexProblem {
	const said = (m: string) => ({ message: m, at });
	let m: RegExpMatchArray | null;
	if ((m = raw.match(/^Undefined control sequence: (\\\S+)/)))
		return said(
			`${m[1]} isn't a command KaTeX knows. Check the spelling, or pick one from the palette.`,
		);
	if (/expected '\}'|Expected '\}', got 'EOF'/i.test(raw))
		return said('A { is never closed: add the matching }.');
	if (/^Expected 'EOF', got '\}'/.test(raw)) return said('There’s a } with no { before it.');
	if (/^Expected 'EOF', got '&'/.test(raw))
		return said('& separates columns, so it only works inside a matrix, cases or aligned block.');
	if (/^Expected '\\right', got 'EOF'/.test(raw))
		return said('\\left needs a matching \\right (use \\right. for an invisible one).');
	if ((m = raw.match(/^Expected group after '(.)'/)))
		return said(
			`Nothing follows ${m[1]}: put the ${m[1] === '^' ? 'power' : 'subscript'} after it, in { } if it's more than one character.`,
		);
	if ((m = raw.match(/^Expected group as argument to '(\\\w+)'/)))
		return said(`${m[1]} needs something in { } after it.`);
	if (/^Expected & or \\\\ or \\cr or \\end/.test(raw))
		return said('This block is never closed: add its \\end{…}.');
	if ((m = raw.match(/^No such environment: (\S+)/)))
		return said(`There's no ${m[1]} environment. Try pmatrix, bmatrix, cases or aligned.`);
	if ((m = raw.match(/Double (superscript|subscript)/)))
		return said(`Two ${m[1]}s in a row: group them in { }, like x^{ab}.`);
	return said(raw);
}

/**
 * Check maths with KaTeX: HTML when it typesets, else what went wrong.
 * `katex` is passed in so callers decide when to load it.
 */
export function checkTex(
	katex: typeof import('katex').default,
	tex: string,
	display: boolean,
): { html: string } | { problem: TexProblem } {
	try {
		return {
			html: katex.renderToString(tex, {
				displayMode: display,
				throwOnError: true,
				strict: 'ignore',
				trust: false,
				maxExpand: 500,
				output: 'htmlAndMathml',
			}),
		};
	} catch (e) {
		const err = e as { rawMessage?: string; message?: string; position?: number };
		const raw = err.rawMessage ?? err.message ?? String(e);
		return {
			problem: explainTexError(raw, typeof err.position === 'number' ? err.position : null),
		};
	}
}

// ------------------------------------------------------------------ snippets

/**
 * A palette entry. `tex` uses `${name}` placeholders (CodeMirror's snippet
 * syntax); `show` is how the button reads.
 */
export interface TexSnippet {
	tex: string;
	show: string;
	label: string;
}

export const TEX_GROUPS: { name: string; items: TexSnippet[] }[] = [
	{
		name: 'Structures',
		items: [
			{ tex: '\\frac{${a}}{${b}}', show: 'a⁄b', label: 'Fraction' },
			{ tex: '^{${n}}', show: 'xⁿ', label: 'Power' },
			{ tex: '_{${i}}', show: 'xᵢ', label: 'Subscript' },
			{ tex: '\\sqrt{${x}}', show: '√x', label: 'Square root' },
			{ tex: '\\sqrt[${n}]{${x}}', show: 'ⁿ√x', label: 'nth root' },
			{ tex: '\\sum_{${i=1}}^{${n}} ${}', show: 'Σ', label: 'Sum' },
			{ tex: '\\prod_{${i=1}}^{${n}} ${}', show: 'Π', label: 'Product' },
			{ tex: '\\int_{${a}}^{${b}} ${f(x)} \\,d${x}', show: '∫', label: 'Integral' },
			{ tex: '\\lim_{${x \\to 0}} ${}', show: 'lim', label: 'Limit' },
			{ tex: '\\frac{d${y}}{d${x}}', show: 'dy⁄dx', label: 'Derivative' },
			{ tex: '\\frac{\\partial ${f}}{\\partial ${x}}', show: '∂f⁄∂x', label: 'Partial derivative' },
			{ tex: '\\binom{${n}}{${k}}', show: '(ⁿₖ)', label: 'Binomial' },
			{ tex: '\\left( ${} \\right)', show: '( )', label: 'Brackets that grow' },
			{
				tex: '\\begin{pmatrix} ${a} & ${b} \\\\ ${c} & ${d} \\end{pmatrix}',
				show: '[⋯]',
				label: 'Matrix',
			},
			{
				tex: '\\begin{cases} ${x} & \\text{if } ${x > 0} \\\\ ${y} & \\text{otherwise} \\end{cases}',
				show: '{ ⋯',
				label: 'Cases',
			},
			{
				tex: '\\begin{aligned} ${a} &= ${b} \\\\ &= ${c} \\end{aligned}',
				show: '= ⋯',
				label: 'Aligned equations',
			},
			{ tex: '\\vec{${v}}', show: 'vec', label: 'Vector' },
			{ tex: '\\hat{${x}}', show: 'x̂', label: 'Hat' },
			{ tex: '\\bar{${x}}', show: 'x̄', label: 'Bar' },
			{ tex: '\\text{${words}}', show: 'Tt', label: 'Text' },
		],
	},
	{
		name: 'Greek',
		items: (
			[
				['alpha', 'α'],
				['beta', 'β'],
				['gamma', 'γ'],
				['delta', 'δ'],
				['epsilon', 'ε'],
				['zeta', 'ζ'],
				['eta', 'η'],
				['theta', 'θ'],
				['iota', 'ι'],
				['kappa', 'κ'],
				['lambda', 'λ'],
				['mu', 'μ'],
				['nu', 'ν'],
				['xi', 'ξ'],
				['pi', 'π'],
				['rho', 'ρ'],
				['sigma', 'σ'],
				['tau', 'τ'],
				['upsilon', 'υ'],
				['phi', 'φ'],
				['chi', 'χ'],
				['psi', 'ψ'],
				['omega', 'ω'],
				['Gamma', 'Γ'],
				['Delta', 'Δ'],
				['Theta', 'Θ'],
				['Lambda', 'Λ'],
				['Xi', 'Ξ'],
				['Pi', 'Π'],
				['Sigma', 'Σ'],
				['Phi', 'Φ'],
				['Psi', 'Ψ'],
				['Omega', 'Ω'],
			] as const
		).map(([name, show]) => ({ tex: `\\${name}`, show, label: name })),
	},
	{
		name: 'Symbols',
		items: (
			[
				['\\le', '≤', 'less than or equal'],
				['\\ge', '≥', 'greater than or equal'],
				['\\neq', '≠', 'not equal'],
				['\\approx', '≈', 'approximately'],
				['\\equiv', '≡', 'equivalent'],
				['\\propto', '∝', 'proportional to'],
				['\\pm', '±', 'plus or minus'],
				['\\times', '×', 'times'],
				['\\div', '÷', 'divide'],
				['\\cdot', '·', 'dot'],
				['\\infty', '∞', 'infinity'],
				['\\partial', '∂', 'partial'],
				['\\nabla', '∇', 'nabla'],
				['\\to', '→', 'to'],
				['\\Rightarrow', '⇒', 'implies'],
				['\\iff', '⇔', 'if and only if'],
				['\\in', '∈', 'in'],
				['\\notin', '∉', 'not in'],
				['\\subseteq', '⊆', 'subset'],
				['\\cup', '∪', 'union'],
				['\\cap', '∩', 'intersection'],
				['\\forall', '∀', 'for all'],
				['\\exists', '∃', 'exists'],
				['\\emptyset', '∅', 'empty set'],
				['\\mathbb{R}', 'ℝ', 'real numbers'],
				['\\mathbb{N}', 'ℕ', 'natural numbers'],
				['\\mathbb{Z}', 'ℤ', 'integers'],
				['\\mathbb{C}', 'ℂ', 'complex numbers'],
				['\\ldots', '…', 'dots'],
				['\\degree', '°', 'degree'],
			] as const
		).map(([tex, show, label]) => ({ tex, show, label })),
	},
];

/** Snippet text without placeholders, and the first placeholder's range in it (to select). */
export function expandSnippet(tex: string): { text: string; select: [number, number] | null } {
	let text = '';
	let select: [number, number] | null = null;
	let last = 0;
	for (const m of tex.matchAll(/\$\{([^}]*)\}/g)) {
		text += tex.slice(last, m.index);
		if (!select) select = [text.length, text.length + m[1]!.length];
		text += m[1];
		last = m.index + m[0].length;
	}
	text += tex.slice(last);
	return { text, select };
}
