/// Ranking notes for a typed name (link completion, the Link to… picker).

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
