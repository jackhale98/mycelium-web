/// Real-world org files: the org-mode manual and NEWS, org-mode's and
/// org-roam's own test files, and a large published org-roam vault. They are
/// fetched at pinned commits by `scripts/fetch-corpus.mjs` (licences differ
/// from this project's, so they are not vendored) and skipped when absent.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanHeadline, setHeadlineTags, setPriority, setTodoKeyword } from '$lib/org/headline';
import { fileTodoKeywords } from '$lib/org/keywords';
import { parseOrg } from '$lib/org/parse';
import { setPlanning } from '$lib/org/planning';
import { setProperty } from '$lib/org/properties';
import { indexFileTree, type FileIndex } from '$lib/org/roam';
import { scanFile } from '$lib/org/scan';
import { applyChanges, splitLines } from '$lib/org/text';
import { makeTimestamp } from '$lib/org/timestamp';

const ROOT = process.env.CORPUS_DIR ?? join(process.cwd(), 'tests/corpus/.cache');
const files = (dir: string): string[] =>
	!existsSync(dir)
		? []
		: readdirSync(dir).flatMap((name) => {
				const path = join(dir, name);
				return statSync(path).isDirectory()
					? files(path)
					: name.endsWith('.org') || name === 'ORG-NEWS'
						? [path]
						: [];
			});
const corpus = files(ROOT);
const keywordsFor = (s: string) =>
	fileTodoKeywords(s) ?? { todoKeywords: ['TODO', 'NEXT'], doneKeywords: ['DONE'] };

function essentials(idx: FileIndex) {
	return {
		title: idx.title,
		excluded: idx.excluded,
		filetags: idx.filetags,
		nodes: idx.nodes.map((n) => ({
			...n,
			scheduled: n.scheduled?.raw ?? null,
			deadline: n.deadline?.raw ?? null,
		})),
		headlines: idx.headlines.map((h) => ({
			...h,
			scheduled: h.scheduled?.raw ?? null,
			deadline: h.deadline?.raw ?? null,
			closed: h.closed?.raw ?? null,
		})),
		links: idx.links
			.filter((l) => l.type === 'id' || l.type === 'roam' || l.type === 'file')
			.map((l) => ({ source: l.source, dest: l.dest, type: l.type, pos: l.pos, end: l.end })),
	};
}

describe.skipIf(corpus.length === 0)(
	`real-world corpus (${corpus.length} files)`,
	{ timeout: 120_000 },
	() => {
		for (const path of corpus) {
			const name = relative(ROOT, path);
			describe(name, () => {
				const source = readFileSync(path, 'utf8');
				const keywords = keywordsFor(source);

				it('parses, and the scanner agrees with the tree', () => {
					expect(() => parseOrg(source, keywords)).not.toThrow();
					expect(essentials(scanFile(name, source, keywords))).toEqual(
						essentials(indexFileTree(name, source, keywords)),
					);
				});

				it('round-trips every headline edit byte for byte', () => {
					const headlines = splitLines(source)
						.map((l) => scanHeadline(l, keywords))
						.filter((h) => h !== null)
						.slice(0, 60);
					for (const h of headlines) {
						const at = h.line.from;
						const kw = h.keyword?.value ?? null;
						const first = keywords.todoKeywords[0] ?? 'TODO';
						if (kw) {
							// Switching to another state and back is exact.
							const other = kw === first ? (keywords.doneKeywords[0] ?? 'DONE') : first;
							const t = applyChanges(source, setTodoKeyword(source, at, other, keywords));
							expect(applyChanges(t, setTodoKeyword(t, at, kw, keywords)), `keyword @${at}`).toBe(
								source,
							);
							// Removing one touches only that line.
							const r = applyChanges(source, setTodoKeyword(source, at, null, keywords));
							expect(r.slice(0, at)).toBe(source.slice(0, at));
							expect(r.slice(r.length - (source.length - h.line.end))).toBe(
								source.slice(h.line.end),
							);
						} else {
							const t = applyChanges(source, setTodoKeyword(source, at, first, keywords));
							expect(applyChanges(t, setTodoKeyword(t, at, null, keywords)), `keyword @${at}`).toBe(
								source,
							);
						}
						if (!h.priority) {
							const p = applyChanges(source, setPriority(source, at, 'A', keywords));
							expect(applyChanges(p, setPriority(p, at, null, keywords)), `priority @${at}`).toBe(
								source,
							);
						}
						const tags = h.tags?.values ?? [];
						const g = applyChanges(
							source,
							setHeadlineTags(source, at, [...tags, 'corpus'], keywords),
						);
						expect(
							applyChanges(g, setHeadlineTags(g, at, tags, keywords)),
							`tags @${at}: ${h.line.text}`,
						).toBe(source);
						const before = splitLines(source)[h.line.index + 1]?.text ?? '';
						if (!/^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(before)) {
							const s = applyChanges(
								source,
								setPlanning(
									source,
									at,
									'SCHEDULED',
									makeTimestamp({ date: '2031-02-03' }),
									keywords,
								),
							);
							expect(
								applyChanges(s, setPlanning(s, at, 'SCHEDULED', null, keywords)),
								`planning @${at}`,
							).toBe(source);
						}
						const q = applyChanges(source, setProperty(source, at, 'CORPUS', 'x', keywords));
						expect(q.length).toBeGreaterThan(source.length);
					}
				});
			});
		}
	},
);
