/// Synthetic large-vault timings. Skipped unless BENCH is set:
///   BENCH=1 BENCH_FILES=5000 npx vitest run tests/bench
import { describe, expect, it } from 'vitest';
import { indexFile } from '$lib/org';
import { Vault } from '$lib/vault/vault';
import { buildSearch } from '$lib/vault/search';
import { groupAgenda } from '../../src/app/agenda';

const FILES = Number(process.env.BENCH_FILES ?? 5000);

function makeVault(count: number): Record<string, string> {
	const files: Record<string, string> = {};
	for (let i = 0; i < count; i += 1) {
		const id = `node-${i}`;
		const links = [1, 7, 31]
			.map((k) => `[[id:node-${(i * k + 3) % count}][Note ${(i * k + 3) % count}]]`)
			.join(', ');
		const day = String((i % 28) + 1).padStart(2, '0');
		files[`notes/${i}.org`] = `:PROPERTIES:
:ID:       ${id}
:ROAM_ALIASES: "Alias ${i}"
:END:
#+title: Note ${i}
#+filetags: :tag${i % 20}:topic${i % 7}:

Some body text for note ${i} that mentions ${links} and continues for a while
with *bold*, /italic/ and =verbatim= words so the parser has real work to do.

* TODO Task ${i} :work:
SCHEDULED: <2026-10-${day} Tue>
- [ ] first
- [X] second

* Section ${i}
:PROPERTIES:
:ID:       ${id}-h
:END:
More text with a [[https://example.com][link]] and a table:
| a | b |
|---+---|
| 1 | 2 |

** DONE Old task ${i}
CLOSED: [2026-09-${day} Mon 10:00]

#+begin_src python
print("hello ${i}")
#+end_src
`;
	}
	return files;
}

function time<T>(label: string, run: () => T): T {
	const start = performance.now();
	const out = run();
	console.log(`${label.padEnd(36)} ${(performance.now() - start).toFixed(1).padStart(8)} ms`);
	return out;
}

describe.skipIf(!process.env.BENCH)(`vault of ${FILES} files`, () => {
	it('stays fast', () => {
		const sources = makeVault(FILES);
		const entries = Object.entries(sources);
		const kb = Math.round(entries.reduce((n, [, s]) => n + s.length, 0) / 1024);
		time('index every file (cold start)', () => {
			for (const [path, source] of entries) indexFile(path, source);
		});
		const vault = time('index + build vault maps', () => Vault.fromSources(sources));
		const links = [...vault.backlinks.values()].reduce((n, l) => n + l.length, 0);
		console.log(
			`${FILES} files · ${kb} KB · ${vault.nodes.size} nodes · ${links} links · ${vault.agenda().length} agenda items`,
		);
		const [path, source] = entries[42]!;
		time('re-index one edited file', () => indexFile(path, `${source}\n* TODO New\n`));
		time('vault.update after one edit', () => vault.update(path, `${source}\n* TODO New\n`));
		const groups = time('agenda grouping (all files)', () => groupAgenda(vault, '2026-10-15'));
		const search = time('build search index', () => buildSearch(vault));
		time('search query', () => search.search('note 4'));
		time('backlinks lookup', () => vault.backlinksOf('node-7'));
		expect(groups.today.length + groups.upcoming.length + groups.overdue.length).toBeGreaterThan(0);
	});
});
