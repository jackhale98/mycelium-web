import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { indexFileTree, parseRefs } from '../roam';
import { scanFile } from '../scan';

const fixture = (path: string) =>
	readFileSync(new URL(`../../../../tests/fixtures/${path}`, import.meta.url), 'utf8');
const keywords = { todoKeywords: ['TODO', 'NEXT'], doneKeywords: ['DONE'] };

for (const [name, indexFile] of [
	['tree', indexFileTree],
	['scanner', scanFile],
] as const)
	describe(`indexFile (${name})`, () => {
		it('extracts file and headline nodes with inherited tags', () => {
			const idx = indexFile('projects.org', fixture('sample-vault/projects.org'), keywords);
			expect(idx.title).toBe('Projects');
			const ids = idx.nodes.map((n) => n.id);
			expect(ids).toEqual([
				'20240115-projects',
				'20240115-mycelium',
				'20240115-mycelium-arch',
				'20240115-paper',
				'20240115-daily',
			]);
			const arch = idx.nodes.find((n) => n.id === '20240115-mycelium-arch')!;
			expect(arch).toMatchObject({ level: 2, todo: 'DONE', olp: ['Mycelium'] });
			expect(arch.tags).toEqual(['projects', 'app', 'rust']);
			expect(idx.nodes.find((n) => n.id === '20240115-paper')!.refs).toEqual([
				{ ref: '//arxiv.org/example', type: 'https' },
			]);
		});

		it('attributes links to the innermost node with context', () => {
			const idx = indexFile('projects.org', fixture('sample-vault/projects.org'), keywords);
			const toRust = idx.links.filter((l) => l.dest === '20240115-rust');
			expect(toRust).toHaveLength(1);
			expect(toRust[0]).toMatchObject({
				source: '20240115-mycelium',
				type: 'id',
				description: 'Rust',
			});
			expect(toRust[0]!.context).toContain('Uses [[id:20240115-rust][Rust]] for the backend.');
			const fromDaily = idx.links.filter((l) => l.source === '20240115-daily').map((l) => l.dest);
			expect(fromDaily).toEqual(['20240115-mycelium', '20240115-ownership', '20240115-org-roam']);
		});

		it('handles CRLF, blocks, verbatim and aligned tags', () => {
			const idx = indexFile('crlf.org', fixture('edge-cases/crlf-no-final-newline.org'), keywords);
			expect(idx.nodes.map((n) => n.id)).toEqual(['crlf-file', 'crlf-head']);
			expect(idx.nodes[0]!.aliases).toEqual(['Windows note', 'crlf']);
			expect(idx.nodes[1]).toMatchObject({
				title: 'Fix line endings',
				todo: 'TODO',
				priority: 'B',
				tags: ['windows', 'bug'],
			});
			expect(idx.nodes[1]!.scheduled?.repeater).toBe('+1w');
			expect(idx.links.map((l) => l.dest)).toEqual(['20240115-rust']);
			expect(idx.headlines).toHaveLength(1);
		});

		it('honours per-file keywords, excludes and refs', () => {
			const idx = indexFile('custom.org', fixture('edge-cases/custom-keywords.org'), keywords);
			expect(idx.keywords.todoKeywords).toEqual(['TODO', 'WAITING']);
			const waiting = idx.headlines.find((h) => h.title.startsWith('Response'))!;
			expect(waiting.todo).toBe('WAITING');
			expect(waiting.deadline?.warning).toBe('-3d');
			expect(idx.headlines.find((h) => h.title === 'Old plan')!.closed?.date).toBe('2024-01-20');
			expect(idx.nodes.map((n) => n.id)).toEqual(['custom-kw', 'unicode-node']);
			expect(idx.nodes[0]!.refs).toEqual([
				{ ref: '//example.com/paper', type: 'https' },
				{ ref: 'smith2020', type: 'cite' },
				{ ref: 'doe2021', type: 'cite' },
			]);
			expect(idx.nodes[1]!.tags).toContain('日本語');
			expect(idx.links.find((l) => l.type === 'https')).toMatchObject({
				source: 'unicode-node',
				description: 'web link',
			});
		});

		it('marks excluded files', () => {
			const idx = indexFile(
				'x.org',
				':PROPERTIES:\n:ID: x\n:ROAM_EXCLUDE: t\n:END:\n* H\n:PROPERTIES:\n:ID: y\n:END:\n',
			);
			expect(idx.excluded).toBe(true);
			expect(idx.nodes).toEqual([]);
		});

		it('falls back to the file name for untitled files', () => {
			expect(indexFile('daily/2024-01-16.org', 'Text\n').title).toBe('2024-01-16');
		});
	});

describe('parseRefs', () => {
	it('understands citation and url forms', () => {
		expect(parseRefs('[cite:@a] cite:b @c "https://x.y/z q"')).toEqual([
			{ ref: 'a', type: 'cite' },
			{ ref: 'b', type: 'cite' },
			{ ref: 'c', type: 'cite' },
			{ ref: '//x.y/z q', type: 'https' },
		]);
	});
});
