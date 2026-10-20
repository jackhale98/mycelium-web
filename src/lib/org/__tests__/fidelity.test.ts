/// Byte-fidelity checks over every fixture file: each edit must be undoable to
/// the exact original bytes, must not mix line endings, and must leave the
/// rest of the document's structure as it was.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanHeadline, setHeadlineTags, setPriority, setTodoKeyword } from '../headline';
import { fileTodoKeywords } from '../keywords';
import { setPlanning } from '../planning';
import { setProperty } from '../properties';
import { scanFile as indexFile } from '../scan';
import { applyChanges, splitLines, type Change } from '../text';
import { makeTimestamp } from '../timestamp';
import { DEFAULT_KEYWORD_CONFIG } from '../types';

const root = fileURLToPath(new URL('../../../../tests/fixtures', import.meta.url));
const files = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : name.endsWith('.org') ? [path] : [];
	});

const apply = (s: string, c: Change[]) => applyChanges(s, c);
const lineEndings = (s: string) => ({
	crlf: (s.match(/\r\n/g) ?? []).length,
	lf: (s.match(/(?<!\r)\n/g) ?? []).length,
});

for (const path of files(root)) {
	const source = readFileSync(path, 'utf8');
	const keywords = fileTodoKeywords(source) ?? {
		todoKeywords: ['TODO', 'NEXT'],
		doneKeywords: ['DONE'],
	};
	const name = path.slice(root.length + 1);
	const headlines = splitLines(source)
		.map((line) => scanHeadline(line, keywords))
		.filter((h) => h !== null);
	const usesCrlf = source.includes('\r\n');

	describe(`fidelity: ${name}`, () => {
		it('keeps line endings consistent through edits', () => {
			for (const h of headlines) {
				const out = apply(
					source,
					setPlanning(
						source,
						h.line.from,
						'DEADLINE',
						makeTimestamp({ date: '2030-01-01' }),
						keywords,
					),
				);
				const endings = lineEndings(out);
				if (usesCrlf) expect(endings.lf).toBe(0);
				else expect(endings.crlf).toBe(0);
			}
		});

		it('undoes every reversible headline edit byte-for-byte', () => {
			for (const h of headlines) {
				const at = h.line.from;
				const kw = h.keyword?.value ?? null;
				const toggled = apply(source, setTodoKeyword(source, at, kw ? null : 'TODO', keywords));
				expect(
					apply(toggled, setTodoKeyword(toggled, at, kw, keywords)),
					`keyword: ${h.line.text}`,
				).toBe(source);

				if (!h.priority) {
					const p = apply(source, setPriority(source, at, 'A', keywords));
					expect(apply(p, setPriority(p, at, null, keywords)), `priority: ${h.line.text}`).toBe(
						source,
					);
				}
				const tags = h.tags?.values ?? [];
				const t = apply(source, setHeadlineTags(source, at, [...tags, 'fidelity'], keywords));
				expect(
					apply(t, setHeadlineTags(t, at, tags, keywords)),
					`tags: ${h.line.text} -> ${splitLines(t)[h.line.index]?.text}`,
				).toBe(source);
			}
		});

		it('only changes the targeted lines', () => {
			for (const h of headlines) {
				const before = splitLines(source);
				const out = apply(source, setTodoKeyword(source, h.line.from, 'DONE', keywords));
				const after = splitLines(out);
				expect(after.length).toBe(before.length);
				after.forEach((line, i) => {
					if (i !== h.line.index)
						expect(line.text + line.eol).toBe(before[i]!.text + before[i]!.eol);
				});
			}
		});

		it('round-trips planning and property additions', () => {
			for (const h of headlines) {
				const at = h.line.from;
				const p = apply(
					source,
					setPlanning(source, at, 'SCHEDULED', makeTimestamp({ date: '2031-02-03' }), keywords),
				);
				if (!/SCHEDULED:/.test(splitLines(source)[h.line.index + 1]?.text ?? '')) {
					expect(apply(p, setPlanning(p, at, 'SCHEDULED', null, keywords))).toBe(source);
				}
				const q = apply(source, setProperty(source, at, 'FIDELITY', 'yes', keywords));
				expect(apply(q, setProperty(q, at, 'FIDELITY', null, keywords))).not.toContain(
					':FIDELITY:',
				);
			}
		});

		it('keeps the index stable under a keyword edit', () => {
			const base = indexFile(name, source, DEFAULT_KEYWORD_CONFIG);
			for (const h of headlines) {
				const out = apply(source, setTodoKeyword(source, h.line.from, 'DONE', keywords));
				const idx = indexFile(name, out, DEFAULT_KEYWORD_CONFIG);
				expect(idx.nodes.map((n) => n.id)).toEqual(base.nodes.map((n) => n.id));
				expect(idx.links.map((l) => l.dest)).toEqual(base.links.map((l) => l.dest));
			}
		});
	});
}
