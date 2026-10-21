import { describe, expect, it } from 'vitest';
import { CursorExpired, RemoteConflict, RemoteNotFound, type RemoteEntry } from './remote';
import { syncFolder, type Base, type SyncResult } from './engine';
import type { RemoteFiles } from './remote';

/** An in-memory file service with revisions and a change log. */
class FakeRemote implements RemoteFiles {
	files = new Map<string, { path: string; rev: string; text: string }>();
	log: RemoteEntry[] = [];
	#rev = 0;
	uploads = 0;
	/** Called before each upload (to simulate another device racing it). */
	beforeUpload: (() => void) | null = null;

	put(path: string, text: string) {
		const rev = `r${++this.#rev}`;
		this.files.set(path.toLowerCase(), { path, rev, text });
		this.log.push({ tag: 'file', path, pathLower: path.toLowerCase(), rev });
		return rev;
	}
	remove(path: string) {
		this.files.delete(path.toLowerCase());
		this.log.push({ tag: 'deleted', path, pathLower: path.toLowerCase() });
	}

	async listAll(start: { path: string } | { cursor: string }) {
		if ('cursor' in start) {
			if (start.cursor === 'stale') throw new CursorExpired();
			return { entries: this.log.slice(Number(start.cursor)), cursor: String(this.log.length) };
		}
		const prefix = start.path.toLowerCase();
		const entries = [...this.files.values()]
			.filter((f) => f.path.toLowerCase().startsWith(`${prefix}/`))
			.map((f) => ({
				tag: 'file' as const,
				path: f.path,
				pathLower: f.path.toLowerCase(),
				rev: f.rev,
			}));
		return { entries, cursor: String(this.log.length) };
	}
	async download(path: string) {
		const f = this.files.get(path.toLowerCase());
		if (!f) throw new RemoteNotFound(path);
		return { text: f.text, rev: f.rev };
	}
	async upload(path: string, text: string, rev: string | null) {
		this.beforeUpload?.();
		const f = this.files.get(path.toLowerCase());
		if (rev ? f?.rev !== rev : f) throw new RemoteConflict(path);
		this.uploads += 1;
		return { rev: this.put(path, text) };
	}
	async delete(path: string, rev: string | null) {
		const f = this.files.get(path.toLowerCase());
		if (!f) return;
		if (rev && f.rev !== rev) throw new RemoteConflict(path);
		this.remove(path);
	}
}

/** A device: its local files, bases, cursor and pending edits. */
class Device {
	files = new Map<string, string>();
	bases = new Map<string, Base>();
	cursor: string | null = null;
	pending = new Set<string>();

	constructor(
		readonly dropbox: FakeRemote,
		readonly root = '/Notes',
	) {}

	edit(path: string, text: string | null) {
		if (text === null) this.files.delete(path);
		else this.files.set(path, text);
		this.pending.add(path);
	}

	async sync(resolutions?: Map<string, string>): Promise<SyncResult> {
		const result = await syncFolder({
			api: this.dropbox,
			root: this.root,
			cursor: this.cursor,
			pending: this.pending,
			include: (p) => p.endsWith('.org'),
			resolutions,
			store: {
				local: async (p) => this.files.get(p) ?? null,
				paths: async () => [...this.files.keys()],
				bases: async () => new Map(this.bases),
			},
		});
		for (const w of result.writes)
			if (w.source === null) this.files.delete(w.path);
			else this.files.set(w.path, w.source);
		for (const [p, b] of result.bases)
			if (b) this.bases.set(p, b);
			else this.bases.delete(p);
		this.cursor = result.cursor;
		this.pending = new Set(result.pending);
		return result;
	}
}

const remote = (d: FakeRemote, path: string) => d.files.get(`/notes/${path}`.toLowerCase())?.text;

describe('syncFolder', () => {
	it('downloads a folder on first sync, ignoring files outside it and non-org files', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/a.org', '* A\n');
		dbx.put('/Notes/daily/2026-10-21.org', '* Today\n');
		dbx.put('/Notes/picture.png', 'binary');
		dbx.put('/Other/b.org', '* B\n');
		const dev = new Device(dbx);
		const r = await dev.sync();
		expect([...dev.files.keys()].sort()).toEqual(['a.org', 'daily/2026-10-21.org']);
		expect(r.pulled).toBe(2);
		expect(dev.cursor).not.toBeNull();
	});

	it('uploads local edits and new files, then sees nothing new', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/a.org', '* A\n');
		const dev = new Device(dbx);
		await dev.sync();
		dev.edit('a.org', '* A\nmore\n');
		dev.edit('new.org', '* New\n');
		const r = await dev.sync();
		expect(r.pushed).toBe(2);
		expect(remote(dbx, 'a.org')).toBe('* A\nmore\n');
		expect(remote(dbx, 'new.org')).toBe('* New\n');
		expect(dev.pending.size).toBe(0);
		// Our own uploads come back through the cursor but aren't downloaded again.
		const again = await dev.sync();
		expect(again.pulled + again.pushed + again.writes.length).toBe(0);
	});

	it('carries edits from one device to another', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/a.org', '* A\n');
		const phone = new Device(dbx);
		const laptop = new Device(dbx);
		await phone.sync();
		await laptop.sync();
		laptop.edit('a.org', '* DONE A\n');
		await laptop.sync();
		const r = await phone.sync();
		expect(r.writes).toEqual([{ path: 'a.org', source: '* DONE A\n' }]);
		expect(phone.files.get('a.org')).toBe('* DONE A\n');
	});

	it('merges edits to different lines made on two devices', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/list.org', '* TODO one\n* TODO two\n* TODO three\n');
		const phone = new Device(dbx);
		const laptop = new Device(dbx);
		await phone.sync();
		await laptop.sync();
		laptop.edit('list.org', '* DONE one\n* TODO two\n* TODO three\n');
		await laptop.sync();
		phone.edit('list.org', '* TODO one\n* TODO two\n* DONE three\n');
		const r = await phone.sync();
		expect(r.conflicts).toEqual([]);
		const merged = '* DONE one\n* TODO two\n* DONE three\n';
		expect(phone.files.get('list.org')).toBe(merged);
		expect(remote(dbx, 'list.org')).toBe(merged);
		await laptop.sync();
		expect(laptop.files.get('list.org')).toBe(merged);
	});

	it('reports overlapping edits as conflicts until the chosen text is applied', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/a.org', '* Title\n');
		const phone = new Device(dbx);
		const laptop = new Device(dbx);
		await phone.sync();
		await laptop.sync();
		laptop.edit('a.org', '* Laptop title\n');
		await laptop.sync();
		phone.edit('a.org', '* Phone title\n');
		const r = await phone.sync();
		expect(r.conflicts).toHaveLength(1);
		expect(r.conflicts[0]).toMatchObject({
			path: 'a.org',
			base: '* Title\n',
			ours: '* Phone title\n',
			theirs: '* Laptop title\n',
		});
		// Nothing is uploaded or overwritten while the conflict is open…
		expect(remote(dbx, 'a.org')).toBe('* Laptop title\n');
		expect(phone.files.get('a.org')).toBe('* Phone title\n');
		// …and the next sync (an automatic one, say) still reports it.
		expect((await phone.sync()).conflicts).toHaveLength(1);
		expect(remote(dbx, 'a.org')).toBe('* Laptop title\n');

		const resolved = await phone.sync(new Map([['a.org', '* Both titles\n']]));
		expect(resolved.conflicts).toEqual([]);
		expect(phone.files.get('a.org')).toBe('* Both titles\n');
		expect(remote(dbx, 'a.org')).toBe('* Both titles\n');
		await laptop.sync();
		expect(laptop.files.get('a.org')).toBe('* Both titles\n');
	});

	it('deletes locally what was deleted in Dropbox, unless it was edited here', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/a.org', '* A\n');
		dbx.put('/Notes/b.org', '* B\n');
		const dev = new Device(dbx);
		await dev.sync();
		dbx.remove('/Notes/a.org');
		dbx.remove('/Notes/b.org');
		dev.edit('b.org', '* B edited\n');
		await dev.sync();
		expect(dev.files.has('a.org')).toBe(false);
		expect(remote(dbx, 'b.org')).toBe('* B edited\n');
	});

	it('deletes in Dropbox what was deleted here', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/a.org', '* A\n');
		const dev = new Device(dbx);
		await dev.sync();
		dev.edit('a.org', null);
		await dev.sync();
		expect(remote(dbx, 'a.org')).toBeUndefined();
		expect(dev.bases.size).toBe(0);
	});

	it('keeps a remote edit over a local delete', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/a.org', '* A\n');
		const dev = new Device(dbx);
		await dev.sync();
		dbx.put('/Notes/a.org', '* A edited elsewhere\n');
		dev.edit('a.org', null);
		await dev.sync();
		expect(dev.files.get('a.org')).toBe('* A edited elsewhere\n');
		expect(remote(dbx, 'a.org')).toBe('* A edited elsewhere\n');
	});

	it('drops everything under a deleted folder', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/daily/a.org', '* A\n');
		dbx.put('/Notes/daily/b.org', '* B\n');
		dbx.put('/Notes/c.org', '* C\n');
		const dev = new Device(dbx);
		await dev.sync();
		dbx.files.delete('/notes/daily/a.org');
		dbx.files.delete('/notes/daily/b.org');
		dbx.log.push({ tag: 'deleted', path: '/Notes/daily', pathLower: '/notes/daily' });
		await dev.sync();
		expect([...dev.files.keys()]).toEqual(['c.org']);
	});

	it('merges a change that lands in Dropbox while uploading', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/a.org', 'one\ntwo\nthree\n');
		const dev = new Device(dbx);
		await dev.sync();
		dev.edit('a.org', 'ONE\ntwo\nthree\n');
		dbx.beforeUpload = () => {
			dbx.beforeUpload = null;
			dbx.put('/Notes/a.org', 'one\ntwo\nTHREE\n');
		};
		const r = await dev.sync();
		expect(r.conflicts).toEqual([]);
		expect(dev.pending.size).toBe(0);
		expect(remote(dbx, 'a.org')).toBe('ONE\ntwo\nTHREE\n');
		expect(dev.files.get('a.org')).toBe('ONE\ntwo\nTHREE\n');
		// Dropbox's change comes back through the cursor; the base already has it.
		expect((await dev.sync()).writes).toEqual([]);
	});

	it('merges with a base that is behind Dropbox (e.g. an edit made during a sync)', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/a.org', 'one\ntwo\n');
		const dev = new Device(dbx);
		await dev.sync();
		dev.bases.set('a.org', { rev: 'old', source: 'one\ntwo\n' });
		dbx.put('/Notes/a.org', 'one\ntwo\nthree\n');
		dev.cursor = String(dbx.log.length);
		dev.edit('a.org', 'ONE\ntwo\n');
		await dev.sync();
		expect(remote(dbx, 'a.org')).toBe('ONE\ntwo\nthree\n');
	});

	it('keeps the local spelling of a path when Dropbox reports another case', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/Inbox.org', '* In\n');
		const dev = new Device(dbx);
		await dev.sync();
		dbx.files.set('/notes/inbox.org', { path: '/notes/inbox.org', rev: 'rx', text: '* In 2\n' });
		dbx.log.push({
			tag: 'file',
			path: '/notes/inbox.org',
			pathLower: '/notes/inbox.org',
			rev: 'rx',
		});
		await dev.sync();
		expect([...dev.files.keys()]).toEqual(['Inbox.org']);
		expect(dev.files.get('Inbox.org')).toBe('* In 2\n');
	});

	it('starts over with a full listing when the cursor has expired', async () => {
		const dbx = new FakeRemote();
		dbx.put('/Notes/a.org', '* A\n');
		const dev = new Device(dbx);
		await dev.sync();
		dbx.files.delete('/notes/a.org');
		dbx.put('/Notes/b.org', '* B\n');
		dev.cursor = 'stale';
		await dev.sync();
		expect([...dev.files.keys()]).toEqual(['b.org']);
	});

	it('syncs the whole app folder when the root is empty', async () => {
		const dbx = new FakeRemote();
		dbx.put('/a.org', '* A\n');
		const dev = new Device(dbx, '');
		dbx.listAll = async (start) => {
			const entries = [...dbx.files.values()].map((f) => ({
				tag: 'file' as const,
				path: f.path,
				pathLower: f.path.toLowerCase(),
				rev: f.rev,
			}));
			return 'cursor' in start
				? { entries: dbx.log.slice(Number(start.cursor)), cursor: String(dbx.log.length) }
				: { entries, cursor: String(dbx.log.length) };
		};
		await dev.sync();
		expect(dev.files.get('a.org')).toBe('* A\n');
		dev.edit('b.org', '* B\n');
		await dev.sync();
		expect(dbx.files.get('/b.org')?.text).toBe('* B\n');
	});
});
