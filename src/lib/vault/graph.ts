/// The link graph for the graph view: nodes, weighted undirected edges, and
/// an optional neighbourhood around one note.

import type { Vault } from './vault';

export interface GraphNode {
	id: string;
	title: string;
	file: string;
	/** Number of distinct neighbours. */
	degree: number;
	/** First tag, for colouring. */
	tag: string | null;
	daily: boolean;
	/** Hops from the focus note (0 for the focus itself). */
	distance: number | null;
}

export interface GraphLink {
	source: string;
	target: string;
	/** How many links join the pair (either direction). */
	weight: number;
}

export interface GraphOptions {
	/** Fold heading nodes into the note (file) that contains them. */
	collapseHeadings?: boolean;
	includeDailies?: boolean;
	/** Keep notes with no links. */
	includeOrphans?: boolean;
	isDaily?: (path: string) => boolean;
	/** Restrict to notes within `depth` links of this one. */
	focus?: string | null;
	depth?: number;
}

export function buildGraph(vault: Vault, options: GraphOptions = {}) {
	const {
		collapseHeadings = true,
		includeDailies = true,
		includeOrphans = true,
		isDaily = () => false,
	} = options;
	const fileIds = new Map<string, string>();
	if (collapseHeadings)
		for (const node of vault.nodes.values()) {
			const top = vault.fileNode(node.file);
			if (top) fileIds.set(node.id, top.id);
		}
	const canon = (id: string) => (collapseHeadings ? (fileIds.get(id) ?? id) : id);

	const nodes = new Map<string, GraphNode>();
	for (const node of vault.nodes.values()) {
		const id = canon(node.id);
		if (nodes.has(id)) continue;
		const owner = vault.node(id) ?? node;
		const daily = isDaily(owner.file);
		if (daily && !includeDailies) continue;
		nodes.set(id, {
			id,
			title: owner.title,
			file: owner.file,
			degree: 0,
			tag: owner.tags[0] ?? null,
			daily,
			distance: null,
		});
	}

	const pairs = new Map<string, GraphLink>();
	const neighbours = new Map<string, Set<string>>();
	for (const [dest, links] of vault.backlinks) {
		const b = canon(dest);
		for (const link of links) {
			const a = canon(link.from.id);
			if (a === b || !nodes.has(a) || !nodes.has(b)) continue;
			const [s, t] = a < b ? [a, b] : [b, a];
			const key = `${s}\u0000${t}`;
			const pair = pairs.get(key);
			if (pair) pair.weight += 1;
			else {
				pairs.set(key, { source: s, target: t, weight: 1 });
				for (const [x, y] of [
					[s, t],
					[t, s],
				] as const) {
					if (!neighbours.has(x)) neighbours.set(x, new Set());
					neighbours.get(x)!.add(y);
				}
			}
		}
	}
	for (const [id, set] of neighbours) nodes.get(id)!.degree = set.size;

	let keep: Set<string> | null = null;
	const focus = options.focus ? canon(options.focus) : null;
	if (focus && nodes.has(focus)) {
		keep = new Set([focus]);
		nodes.get(focus)!.distance = 0;
		let frontier = [focus];
		for (let d = 1; d <= (options.depth ?? 2); d++) {
			const next: string[] = [];
			for (const id of frontier)
				for (const n of neighbours.get(id) ?? [])
					if (!keep.has(n)) {
						keep.add(n);
						nodes.get(n)!.distance = d;
						next.push(n);
					}
			frontier = next;
		}
	}

	const outNodes = [...nodes.values()].filter((n) =>
		keep ? keep.has(n.id) : includeOrphans || n.degree > 0,
	);
	const ids = new Set(outNodes.map((n) => n.id));
	const outLinks = [...pairs.values()].filter((l) => ids.has(l.source) && ids.has(l.target));
	return { nodes: outNodes, links: outLinks, focus: focus && nodes.has(focus) ? focus : null };
}
