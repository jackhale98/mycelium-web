/// The outline of an org file, for folding as org's TAB and S-TAB do: each
/// heading's subtree (to the next heading at its level or above), its own
/// text (up to its first child), and its direct children.

export interface OutlineHeading {
	/** Start of the heading line. */
	pos: number;
	/** End of the heading line (before its newline). */
	lineEnd: number;
	level: number;
	/** Where the subtree ends: the next heading at this level or above, or the end. */
	end: number;
	/** Where the heading's own text ends: its first child heading, or `end`. */
	bodyEnd: number;
	/** Indexes of its direct children in the outline. */
	children: number[];
	/** Index of its parent, or null at the top. */
	parent: number | null;
}

const HEADING = /^(\*+)[ \t]/;

/** Every heading in `source`, in order (lines inside blocks don't count). */
export function outline(source: string): OutlineHeading[] {
	const out: OutlineHeading[] = [];
	const stack: number[] = [];
	let block: string | null = null;
	let at = 0;
	while (at <= source.length) {
		const nl = source.indexOf('\n', at);
		const lineEnd = nl === -1 ? source.length : nl;
		const line = source.slice(at, lineEnd);
		if (block) {
			if (new RegExp(`^[ \\t]*#\\+end_${block}\\b`, 'i').test(line)) block = null;
		} else {
			const b = /^[ \t]*#\+begin_(\w+)/i.exec(line);
			const m = b ? null : HEADING.exec(line);
			if (b) block = b[1]!;
			else if (m) {
				const level = m[1]!.length;
				while (stack.length && out[stack[stack.length - 1]!]!.level >= level) {
					out[stack.pop()!]!.end = at;
				}
				const parent = stack.length ? stack[stack.length - 1]! : null;
				const index = out.length;
				out.push({
					pos: at,
					lineEnd,
					level,
					end: source.length,
					bodyEnd: source.length,
					children: [],
					parent,
				});
				if (parent !== null) {
					const p = out[parent]!;
					if (!p.children.length) p.bodyEnd = at;
					p.children.push(index);
				}
				stack.push(index);
			}
		}
		if (nl === -1) break;
		at = nl + 1;
	}
	for (const h of out) if (!h.children.length) h.bodyEnd = h.end;
	return out;
}

/**
 * The text a fold hides, from the end of the heading line to `to` (a
 * subtree's end or its first child), without the newline before what
 * follows: null when there's nothing to hide.
 */
export function foldSpan(
	source: string,
	from: number,
	to: number,
): { from: number; to: number } | null {
	let end = to;
	if (end > from && source[end - 1] === '\n') end -= 1;
	return end > from ? { from, to: end } : null;
}

/** `#+STARTUP:` visibility (overview, content, showall), if the file sets one. */
export function startupVisibility(source: string): 'overview' | 'contents' | 'all' | null {
	let found: 'overview' | 'contents' | 'all' | null = null;
	for (const m of source.matchAll(/^[ \t]*#\+startup:[ \t]*(.*)$/gim)) {
		for (const word of m[1]!.toLowerCase().split(/\s+/)) {
			if (word === 'overview' || word === 'fold') found = 'overview';
			else if (word === 'content') found = 'contents';
			else if (word === 'showall' || word === 'showeverything' || word === 'nofold') found = 'all';
		}
	}
	return found;
}
