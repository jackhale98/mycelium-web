/// Differential test: the fast scanner must agree with the uniorg-based
/// reference extractor on every fixture and demo file.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { indexFileTree, type FileIndex } from '../roam';
import { inlinePlain, scanFile } from '../scan';

const roots = ['../../../../tests/fixtures', '../../../demo/vault'].map((p) =>
	fileURLToPath(new URL(p, import.meta.url)),
);
const files = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : name.endsWith('.org') ? [path] : [];
	});
const keywords = { todoKeywords: ['TODO', 'NEXT'], doneKeywords: ['DONE'] };

/** The parts of an index that the app relies on, in comparable form. */
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
			.filter(
				(l) => l.type === 'id' || l.type === 'roam' || l.type === 'file' || l.type === 'https',
			)
			.map((l) => ({
				source: l.source,
				dest: l.dest,
				type: l.type,
				pos: l.pos,
				end: l.end,
				description: l.description,
			})),
	};
}

describe('scanner agrees with the tree extractor', () => {
	for (const root of roots) {
		for (const path of files(root)) {
			const name = path.slice(root.length + 1);
			it(name, () => {
				const source = readFileSync(path, 'utf8');
				expect(essentials(scanFile(name, source, keywords))).toEqual(
					essentials(indexFileTree(name, source, keywords)),
				);
			});
		}
	}

	it('handles tricky inline content', () => {
		const source = [
			':PROPERTIES:',
			':ID: f',
			':END:',
			'#+title: Tricky',
			'Text with =[[id:verbatim]]= and ~[[id:code]]~ then [[id:real][a *bold* desc]].',
			'',
			'# [[id:commented]]',
			': [[id:fixed-width]]',
			'#+begin_example',
			'[[id:example]]',
			'#+end_example',
			'#+begin_quote',
			'Quoted [[id:quoted]] link',
			'#+end_quote',
			'- item one [[id:item]]',
			'  continued [[id:continued]]',
			'* Heading with [[id:in-title][link]] :tag:',
			':LOGBOOK:',
			'- State "DONE" [[id:logbook]]',
			':END:',
			'| cell [[id:cell]] |',
		].join('\n');
		expect(essentials(scanFile('t.org', source, keywords))).toEqual(
			essentials(indexFileTree('t.org', source, keywords)),
		);
	});
});

describe('inlinePlain', () => {
	it('strips markup like org does', () => {
		expect(inlinePlain('A *bold* /it/ =v= [[id:x][desc]] [[https://e.com]] [1/3]')).toBe(
			'A bold it v desc //e.com',
		);
	});
});
