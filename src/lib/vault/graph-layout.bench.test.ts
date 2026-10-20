/// Layout quality on a real org-roam vault (BENCH=1): edge crossings for the
/// old settings vs the tuned layout. Uses the braindump corpus.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
} from 'd3-force';
import { describe, expect, it } from 'vitest';
import { buildGraph } from './graph';
import {
	countCrossings,
	createLayout,
	seedPositions,
	warmupTicks,
	type LayoutNode,
} from './graph-layout';
import { Vault } from './vault';

const dir = join(process.cwd(), 'tests/corpus/.cache/braindump/org');
const run = process.env['BENCH'] ? describe : describe.skip;

run('graph layout on braindump', () => {
	it('crosses fewer links than the old layout', async () => {
		const sources: Record<string, string> = {};
		for (const f of readdirSync(dir, { recursive: true }) as string[])
			if (f.endsWith('.org')) sources[f] = readFileSync(join(dir, f), 'utf8');
		const g = buildGraph(Vault.fromSources(sources), { includeOrphans: false });
		const make = () => {
			const nodes: (LayoutNode & { x?: number; y?: number })[] = g.nodes.map((n) => ({
				id: n.id,
				degree: n.degree,
				r: 3.5 + Math.sqrt(n.degree) * 2.2,
			}));
			const byId = new Map(nodes.map((n) => [n.id, n]));
			const links = g.links.map((l) => ({
				source: byId.get(l.source)!,
				target: byId.get(l.target)!,
				weight: l.weight,
			}));
			return { nodes, links };
		};
		const score = (nodes: LayoutNode[]) =>
			countCrossings(new Map(nodes.map((n) => [n.id, { x: n.x!, y: n.y! }])), g.links);

		const before = make();
		const n = before.nodes.length;
		forceSimulation(before.nodes)
			.stop()
			.force(
				'link',
				forceLink(before.links)
					.distance((l) => 34 + ((l.source as LayoutNode).r + (l.target as LayoutNode).r) * 1.6)
					.strength((l) => Math.min(1, 0.25 + l.weight * 0.12)),
			)
			.force(
				'charge',
				forceManyBody()
					.strength(n > 1500 ? -40 : n > 400 ? -80 : -170)
					.distanceMax(600),
			)
			.force(
				'collide',
				forceCollide<LayoutNode>((d) => d.r + 3),
			)
			.force('center', forceCenter(0, 0))
			.force('x', forceX(0).strength(0.04))
			.force('y', forceY(0).strength(0.04))
			.tick(300);
		const after = make();
		seedPositions(after.nodes, after.links);
		createLayout(after.nodes, after.links).tick(warmupTicks(n));
		const [b, a] = [score(before.nodes), score(after.nodes)];
		console.log(`braindump: ${n} notes, ${g.links.length} links — crossings ${b} → ${a}`);
		(await import('node:fs')).writeFileSync(
			'/tmp/claude-0/layout.txt',
			`${n} notes, ${g.links.length} links: ${b} -> ${a}\n`,
		);
		expect(a).toBeLessThan(b * 0.6);
	}, 120_000);
});
