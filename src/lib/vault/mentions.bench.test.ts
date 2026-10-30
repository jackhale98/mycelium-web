/// Link suggestions on a real vault (BENCH=1): building the pattern for every
/// title, and finding a note's mentions, on the braindump corpus.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findMentions, mentionMatcher } from './mentions';
import { Vault } from './vault';

const dir = join(process.cwd(), 'tests/corpus/.cache/braindump/org');
const run = process.env['BENCH'] ? describe : describe.skip;

run('link suggestions on braindump', () => {
	it('builds the pattern and finds mentions quickly', () => {
		const sources: Record<string, string> = {};
		for (const f of readdirSync(dir, { recursive: true }) as string[])
			if (f.endsWith('.org')) sources[f] = readFileSync(join(dir, f), 'utf8');
		const vault = Vault.fromSources(sources);
		const nodes = [...vault.nodes.values()];
		let t = performance.now();
		const matcher = mentionMatcher(nodes);
		const build = performance.now() - t;
		const times: number[] = [];
		let found = 0;
		for (const file of vault.files.values()) {
			t = performance.now();
			found += findMentions(file.source, matcher, { path: file.path }).length;
			times.push(performance.now() - t);
		}
		times.sort((a, b) => a - b);
		const rows = {
			notes: nodes.length,
			terms: matcher.size,
			'build ms': build,
			'per file, median ms': times[Math.floor(times.length / 2)],
			'per file, slowest ms': times[times.length - 1],
			'all files ms': times.reduce((a, b) => a + b, 0),
			mentions: found,
		};
		process.stdout.write(`${JSON.stringify(rows, null, 1)}\n`);
		expect(rows['per file, slowest ms']).toBeLessThan(50);
	});
});
