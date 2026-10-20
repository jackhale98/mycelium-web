/// Integration tests against a real git server (`git http-backend` over HTTP).

import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'isomorphic-git/http/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startGitServer, type GitServer } from '../../../tests/support/git-server';
import { GitRepo, type RepoConfig } from './repo';

let root: string;
let server: GitServer;
let base: string;

function config(): RepoConfig {
	return {
		url: `${base}/notes.git`,
		provider: 'other',
		branch: null,
		corsProxy: null,
		author: { name: 'Tester', email: 'tester@example.com' },
	};
}

const open = (name: string) =>
	new GitRepo({ promises: fs.promises }, http, join(root, name), config(), () => null);

beforeAll(async () => {
	root = fs.mkdtempSync(join(tmpdir(), 'mycelium-git-'));
	server = await startGitServer('notes', {
		'a.org': '#+title: A\n* TODO one\n* TODO two\n* TODO three\n',
		'daily/2024-01-01.org': '#+title: 2024-01-01\r\n',
	});
	base = server.url;
});

afterAll(() => {
	server?.close();
	fs.rmSync(root, { recursive: true, force: true });
});

describe('GitRepo', () => {
	it('clones an empty repository, then makes and pushes the first commit', async () => {
		server.empty('blank');
		const repo = new GitRepo(
			{ promises: fs.promises },
			http,
			join(root, 'blank'),
			{ ...config(), url: `${base}/blank.git` },
			() => null,
		);
		await repo.clone();
		expect(await repo.branch()).toBe('main');
		expect((await repo.files(() => true)).size).toBe(0);
		expect(await repo.aheadBehind()).toEqual({ ahead: 0, behind: 0 });
		expect(await repo.pull()).toEqual({ status: 'up-to-date' });
		await repo.commit([{ path: 'first.org', content: '#+title: First\n' }], 'First note');
		expect(await repo.push()).toEqual({ status: 'pushed', commits: 1 });
		expect(server.git('blank.git', 'log', '-1', '--format=%s', 'main')).toBe('First note');
	});

	it('clones a private repository with a token, defaulting to its master branch', async () => {
		const secret = await startGitServer(
			'private',
			{ 'p.org': '#+title: P\n' },
			{
				branch: 'master',
				auth: 'x-access-token:ghp_token',
			},
		);
		try {
			const make = (token: string | null) =>
				new GitRepo(
					{ promises: fs.promises },
					http,
					join(root, `private-${token ?? 'none'}`),
					{ ...config(), provider: 'github', url: `${secret.url}/private.git` },
					() => (token ? { token } : null),
				);
			await expect(make(null).clone()).rejects.toThrow();
			await expect(make('wrong').clone()).rejects.toThrow();
			const repo = make('ghp_token');
			await repo.clone();
			expect(await repo.branch()).toBe('master');
			expect([...(await repo.files(() => true)).keys()]).toEqual(['p.org']);
			await repo.commit([{ path: 'p.org', content: '#+title: P2\n' }], 'Edit');
			expect(await repo.push()).toEqual({ status: 'pushed', commits: 1 });
			expect(secret.git('private.git', 'log', '-1', '--format=%s', 'master')).toBe('Edit');
		} finally {
			secret.close();
		}
	});

	it('explains a branch that does not exist', async () => {
		const repo = new GitRepo(
			{ promises: fs.promises },
			http,
			join(root, 'nobranch'),
			{ ...config(), branch: 'master' },
			() => null,
		);
		await expect(repo.clone()).rejects.toThrow(
			"The branch “master” isn't in this repository. It has: main.",
		);
	});

	it('clones, lists org files and reads them byte for byte', async () => {
		const repo = open('clone-a');
		await repo.clone();
		expect(await repo.branch()).toBe('main');
		const files = await repo.files((p) => p.endsWith('.org'));
		expect([...files.keys()].sort()).toEqual(['a.org', 'daily/2024-01-01.org']);
		expect(await repo.readBlob(files.get('daily/2024-01-01.org')!)).toBe('#+title: 2024-01-01\r\n');
	});

	it('commits locally and pushes on sync', async () => {
		const repo = open('clone-a');
		await repo.commit(
			[{ path: 'a.org', content: '#+title: A\n* DONE one\n* TODO two\n* TODO three\n' }],
			'Complete one',
		);
		expect(await repo.unpushed()).toBe(1);
		expect(await repo.sync()).toEqual({ status: 'pushed', commits: 1 });
		expect(await repo.unpushed()).toBe(0);
		expect(await repo.sync()).toEqual({ status: 'up-to-date' });
	});

	it('fast-forwards when only the remote changed', async () => {
		const other = open('clone-b');
		await other.clone();
		await other.commit([{ path: 'new.org', content: '#+title: New\n' }], 'Add new');
		await other.sync();
		const repo = open('clone-a');
		const result = await repo.sync();
		expect(result).toEqual({ status: 'pulled', changed: ['new.org'] });
		expect(await repo.readFile('new.org')).toBe('#+title: New\n');
	});

	it('merges edits to different lines of the same file', async () => {
		const a = open('clone-a');
		const b = open('clone-b');
		await b.sync();
		await a.commit(
			[{ path: 'a.org', content: '#+title: A\n* DONE one\n* NEXT two\n* TODO three\n' }],
			'a edits two',
		);
		await b.commit(
			[{ path: 'a.org', content: '#+title: A\n* DONE one\n* TODO two\n* DONE three\n' }],
			'b edits three',
		);
		expect((await b.sync()).status).toBe('pushed');
		const result = await a.sync();
		expect(result).toEqual({ status: 'merged', changed: ['a.org'] });
		expect(await a.readFile('a.org')).toBe('#+title: A\n* DONE one\n* NEXT two\n* DONE three\n');
		expect((await a.log(1))[0]!.parents).toHaveLength(2);
	});

	it('returns conflicts and completes the merge with resolutions', async () => {
		const a = open('clone-a');
		const b = open('clone-b');
		await b.sync();
		await a.commit(
			[{ path: 'a.org', content: '#+title: A (ours)\n* DONE one\n* NEXT two\n* DONE three\n' }],
			'ours',
		);
		await b.commit(
			[{ path: 'a.org', content: '#+title: A (theirs)\n* DONE one\n* NEXT two\n* DONE three\n' }],
			'theirs',
		);
		await b.sync();
		const result = await a.sync();
		expect(result.status).toBe('conflict');
		if (result.status !== 'conflict') return;
		expect(result.conflicts.map((c) => c.path)).toEqual(['a.org']);
		expect(result.conflicts[0]!.hunks[0]).toEqual({
			conflict: {
				ours: '#+title: A (ours)\n',
				base: '#+title: A\n',
				theirs: '#+title: A (theirs)\n',
			},
		});
		// Nothing is written while conflicts are open.
		expect(await a.readFile('a.org')).toContain('A (ours)');
		const resolved = new Map([['a.org', result.conflicts[0]!.theirs]]);
		expect((await a.sync(resolved)).status).toBe('merged');
		expect(await a.readFile('a.org')).toContain('A (theirs)');
		await b.sync();
		expect(await b.readFile('a.org')).toContain('A (theirs)');
	});

	it('autosaves to the working tree without committing', async () => {
		const a = open('clone-a');
		const head = await a.head();
		await a.write([{ path: 'draft.org', content: '#+title: Draft\n' }]);
		expect(await a.head()).toBe(head);
		expect(await a.readWorking('draft.org')).toBe('#+title: Draft\n');
		await a.discard('draft.org');
		expect(await a.readWorking('draft.org')).toBeNull();
	});

	it('refuses to pull over uncommitted edits to a file the remote changed', async () => {
		const a = open('clone-a');
		const b = open('clone-b');
		await a.sync();
		await b.sync();
		await b.commit([{ path: 'new.org', content: '#+title: New (remote)\n' }], 'remote edit');
		await b.sync();
		await a.write([{ path: 'new.org', content: '#+title: New (local, uncommitted)\n' }]);
		const result = await a.pull(new Set(['new.org']));
		expect(result).toEqual({ status: 'blocked', paths: ['new.org'] });
		expect(await a.readWorking('new.org')).toBe('#+title: New (local, uncommitted)\n');
		await a.discard('new.org');
		expect((await a.pull()).status).toBe('pulled');
		expect(await a.readWorking('new.org')).toBe('#+title: New (remote)\n');
	});

	it('reports ahead and behind, and pushes explicitly', async () => {
		const a = open('clone-a');
		const b = open('clone-b');
		await b.sync();
		await a.commit([{ path: 'x.org', content: 'x\n' }], 'x');
		expect(await a.aheadBehind()).toEqual({ ahead: 1, behind: 0 });
		expect(await a.push()).toEqual({ status: 'pushed', commits: 1 });
		expect(await b.fetch()).toEqual({ ahead: 0, behind: 1 });
	});

	it('creates and switches branches', async () => {
		const a = open('clone-a');
		await a.createBranch('experiment');
		expect(await a.branch()).toBe('experiment');
		await a.commit([{ path: 'exp.org', content: 'exp\n' }], 'experiment');
		await a.switchBranch('main');
		expect(await a.readWorking('exp.org')).toBeNull();
		await a.switchBranch('experiment');
		expect(await a.readWorking('exp.org')).toBe('exp\n');
		await a.switchBranch('main');
	});

	it('exposes history and branches', async () => {
		const a = open('clone-a');
		const history = await a.log(10, 'new.org');
		expect(history.at(-1)!.message).toBe('Add new');
		expect(await a.branches()).toEqual(['experiment', 'main']);
	});
});
