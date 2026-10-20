/// Force layout for the link graph, tuned to untangle: neighbours start near
/// each other, links pull gently (d3's degree-aware strength, so hubs don't
/// drag their whole neighbourhood into a knot), repulsion and label room
/// keep clusters apart, and most of the settling happens before first paint.

import {
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	type Simulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
} from 'd3-force';

export interface LayoutNode extends SimulationNodeDatum {
	id: string;
	degree: number;
	r: number;
}

export interface LayoutLink<N extends LayoutNode> extends SimulationLinkDatum<N> {
	weight: number;
}

/**
 * Starting positions for nodes without one: breadth-first from each
 * component's best-connected note, laid out along a sunflower spiral, so
 * linked notes begin side by side instead of scattered (scattered starts are
 * what leave edges crossed). Components sit next to each other, largest first.
 */
export function seedPositions<N extends LayoutNode>(nodes: N[], links: LayoutLink<N>[]): void {
	const fresh = nodes.filter((n) => n.x === undefined || n.y === undefined);
	if (!fresh.length) return;
	const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
	const id = (e: string | number | N) => (typeof e === 'object' ? e.id : String(e));
	for (const l of links) {
		adj.get(id(l.source))?.push(id(l.target));
		adj.get(id(l.target))?.push(id(l.source));
	}
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const seen = new Set<string>();
	const components: N[][] = [];
	for (const start of [...fresh].sort((a, b) => b.degree - a.degree)) {
		if (seen.has(start.id)) continue;
		const order: N[] = [];
		const queue = [start.id];
		seen.add(start.id);
		while (queue.length) {
			const cur = byId.get(queue.shift()!)!;
			order.push(cur);
			const next = (adj.get(cur.id) ?? [])
				.filter((n) => !seen.has(n))
				.sort((a, b) => byId.get(b)!.degree - byId.get(a)!.degree);
			for (const n of next) {
				seen.add(n);
				queue.push(n);
			}
		}
		components.push(order);
	}
	components.sort((a, b) => b.length - a.length);
	const golden = Math.PI * (3 - Math.sqrt(5));
	let offsetX = 0;
	for (const comp of components) {
		const spread = 18;
		const radius = spread * Math.sqrt(comp.length);
		comp.forEach((n, i) => {
			const r = spread * Math.sqrt(i + 0.5);
			n.x = offsetX + r * Math.cos(i * golden);
			n.y = r * Math.sin(i * golden);
		});
		offsetX += radius * 2 + 40;
	}
	// Centre the whole arrangement.
	const first = components[0] ? 18 * Math.sqrt(components[0].length) : 0;
	const mid = (offsetX - 40) / 2 - first;
	for (const n of fresh) n.x! -= mid;
}

/** How fast the layout cools: slow enough for tangles to slide apart. */
export const ALPHA_DECAY = 0.008;

/**
 * Ticks to run before first paint. Small vaults settle completely off
 * screen; big ones get a head start and finish animating.
 */
export function warmupTicks(count: number): number {
	return count <= 500 ? 860 : count <= 2000 ? 250 : 80;
}

/**
 * Build the simulation (stopped); call `.tick()` and/or `.restart()`.
 * Tuned by counting edge crossings on a real org-roam vault (braindump,
 * 376 notes): firm short links, strong repulsion and a slow cool-down
 * cross about a third as often as the previous settings.
 */
export function createLayout<N extends LayoutNode>(
	nodes: N[],
	links: LayoutLink<N>[],
): Simulation<N, LayoutLink<N>> {
	const n = nodes.length;
	const charge = -Math.min(250, Math.max(40, 5600 / Math.sqrt(Math.max(n, 1))));
	// Small vaults get wider label clearance (longer links tangle them).
	const clearance = n < 60 ? 22 : n < 200 ? 8 : 0;
	return forceSimulation<N, LayoutLink<N>>(nodes)
		.stop()
		.alphaDecay(ALPHA_DECAY)
		.force(
			'link',
			forceLink<N, LayoutLink<N>>(links)
				.id((d) => d.id)
				.distance((l) => 30 + (l.source as N).r + (l.target as N).r)
				.strength(1),
		)
		.force('charge', forceManyBody<N>().strength(charge).distanceMax(800))
		.force('collide', forceCollide<N>((d) => d.r + 6 + clearance).iterations(2))
		.force('x', forceX<N>(0).strength(0.03))
		.force('y', forceY<N>(0).strength(0.03));
}

/** Number of pairs of links that cross (links sharing an end don't count). */
export function countCrossings(
	pos: Map<string, { x: number; y: number }>,
	links: { source: string; target: string }[],
): number {
	const segs = links
		.map((l) => [pos.get(l.source), pos.get(l.target), l.source, l.target] as const)
		.filter(
			(s): s is [{ x: number; y: number }, { x: number; y: number }, string, string] =>
				!!s[0] && !!s[1],
		);
	const ccw = (
		a: { x: number; y: number },
		b: { x: number; y: number },
		c: { x: number; y: number },
	) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
	let crossings = 0;
	for (let i = 0; i < segs.length; i++) {
		const [a, b, s1, t1] = segs[i]!;
		for (let j = i + 1; j < segs.length; j++) {
			const [c, d, s2, t2] = segs[j]!;
			if (s1 === s2 || s1 === t2 || t1 === s2 || t1 === t2) continue;
			if (ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)) crossings++;
		}
	}
	return crossings;
}
