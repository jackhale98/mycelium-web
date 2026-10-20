/// A git-backed vault in the browser: repository storage (LightningFS on
/// IndexedDB), the parsed-file cache, and what the app does with them.
///
/// Edits autosave to the working tree and are tracked as uncommitted
/// changes; the person reviews them, writes a message and commits. Pull and
/// push are separate, explicit actions — this is git, not a sync service.

import './polyfill';
import LightningFS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { scanFile } from '$lib/org';
import { db, fileKey, requestPersistence, type CachedFile, type VaultRecord } from '$lib/store/db';
import { detectKeywords, detectLayout, inVault } from '$lib/vault/layout';
import type { VaultFile } from '$lib/vault/vault';
import {
	GitRepo,
	type FileConflict,
	type Progress,
	type PullResult,
	type PushResult,
} from './repo';

const DIR = '/repo';

export interface LoadProgress {
	phase: string;
	/** 0–1 when known. */
	ratio: number | null;
}

export type FileStatus = { path: string; status: 'added' | 'modified' | 'deleted' };

/** Pull results that change files carry the new texts for the vault to apply. */
export type WorkspacePull =
	| Exclude<PullResult, { status: 'pulled' } | { status: 'merged' }>
	| { status: 'pulled' | 'merged'; changes: { path: string; source: string | null }[] };

export type { FileConflict, PushResult };

function fsFor(id: string, wipe = false) {
	return new LightningFS(`mycelium-repo-${id}`, wipe ? { wipe: true } : undefined);
}

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));
const hash = async (text: string) => (await git.hashBlob({ object: text })).oid;

export class Workspace {
	readonly kind = 'git';
	readonly repo: GitRepo;
	/** Uncommitted paths (persisted with the vault record). */
	#dirty: Set<string>;

	private constructor(public record: VaultRecord) {
		this.#dirty = new Set(record.dirty ?? []);
		this.repo = new GitRepo(
			fsFor(record.id),
			http,
			DIR,
			{
				url: record.url,
				provider: record.provider,
				branch: record.branch,
				corsProxy: record.corsProxy,
				author: record.author,
			},
			() => this.record.credentials,
		);
	}

	static open(record: VaultRecord): Workspace {
		return new Workspace(record);
	}

	/** Clone a remote vault, detect its layout and save it. */
	static async create(
		record: VaultRecord,
		onProgress?: (p: LoadProgress) => void,
	): Promise<Workspace> {
		const ws = new Workspace(record);
		await ws.repo.clone((p: Progress) =>
			onProgress?.({ phase: p.phase, ratio: p.total ? p.loaded / p.total : null }),
		);
		await ws.#detect();
		return ws;
	}

	/** Create a local-only vault (no remote) from files, as one initial commit. */
	static async createLocal(
		record: VaultRecord,
		files: Record<string, string>,
		message: string,
	): Promise<Workspace> {
		const ws = new Workspace(record);
		await ws.repo.init(
			Object.entries(files).map(([path, content]) => ({ path, content })),
			message,
		);
		await ws.#detect();
		return ws;
	}

	async #detect() {
		const files = await this.repo.files((p) => p.toLowerCase().endsWith('.org'));
		const sample: { path: string; hasId: boolean }[] = [];
		const texts: string[] = [];
		for (const [path, oid] of files) {
			const text = await this.repo.readBlob(oid);
			texts.push(text);
			sample.push({ path, hasId: /^[ \t]*:ID:[ \t]+\S/im.test(text) });
		}
		this.record.layout = detectLayout(sample);
		this.record.keywords = detectKeywords(texts);
		this.record.branch = await this.repo.branch();
		await db().vaults.put(this.record);
		void requestPersistence();
	}

	get dirty(): ReadonlySet<string> {
		return this.#dirty;
	}

	async #saveDirty() {
		this.record.dirty = [...this.#dirty];
		await db().vaults.update(this.record.id, { dirty: this.record.dirty });
	}

	/**
	 * Load every org file in the vault — committed content plus uncommitted
	 * edits — reusing cached parses for unchanged blobs.
	 */
	async load(onProgress?: (p: LoadProgress) => void): Promise<VaultFile[]> {
		const keywords = this.record.keywords;
		onProgress?.({ phase: 'Reading notes', ratio: null });
		const head = await this.repo.files((p) => inVault(this.record.layout, p));
		const paths = new Set([
			...head.keys(),
			...[...this.#dirty].filter((p) => inVault(this.record.layout, p)),
		]);
		const cached = new Map(
			(await db().files.where('vaultId').equals(this.record.id).toArray()).map((f) => [f.path, f]),
		);
		const out: VaultFile[] = [];
		const fresh: CachedFile[] = [];
		let done = 0;
		for (const path of paths) {
			let source: string | null = null;
			let oid: string;
			if (this.#dirty.has(path)) {
				source = await this.repo.readWorking(path);
				if (source === null) continue;
				oid = await hash(source);
			} else {
				oid = head.get(path)!;
			}
			const hit = cached.get(path);
			if (hit && hit.oid === oid) {
				out.push({ path, source: hit.source, index: hit.index });
			} else {
				source ??= await this.repo.readBlob(oid);
				const index = scanFile(path, source, keywords);
				out.push({ path, source, index });
				fresh.push({
					key: fileKey(this.record.id, path),
					vaultId: this.record.id,
					path,
					oid,
					source,
					index,
				});
			}
			done += 1;
			if (done % 200 === 0) {
				onProgress?.({ phase: 'Indexing notes', ratio: done / paths.size });
				await yieldToUi();
			}
		}
		const stale = [...cached.keys()]
			.filter((p) => !paths.has(p))
			.map((p) => fileKey(this.record.id, p));
		await db().transaction('rw', db().files, async () => {
			if (fresh.length) await db().files.bulkPut(fresh);
			if (stale.length) await db().files.bulkDelete(stale);
		});
		return out;
	}

	/** Autosave: write to the working tree and remember the paths as uncommitted. */
	async save(changes: { path: string; source: string | null; file?: VaultFile }[]): Promise<void> {
		await this.repo.write(changes.map((c) => ({ path: c.path, content: c.source })));
		for (const c of changes) this.#dirty.add(c.path);
		await this.#saveDirty();
		await this.cache(changes);
	}

	async cache(changes: { path: string; source: string | null; file?: VaultFile }[]) {
		const puts: CachedFile[] = [];
		const deletes: string[] = [];
		for (const c of changes) {
			if (c.source === null || !c.file) {
				deletes.push(fileKey(this.record.id, c.path));
				continue;
			}
			puts.push({
				key: fileKey(this.record.id, c.path),
				vaultId: this.record.id,
				path: c.path,
				oid: await hash(c.source),
				source: c.source,
				index: c.file.index,
			});
		}
		if (puts.length) await db().files.bulkPut(puts);
		if (deletes.length) await db().files.bulkDelete(deletes);
	}

	/** Uncommitted changes, compared with HEAD. Paths edited back to their committed text drop out. */
	async status(): Promise<FileStatus[]> {
		if (this.#dirty.size === 0) return [];
		const head = await this.repo.files((p) => this.#dirty.has(p));
		const out: FileStatus[] = [];
		for (const path of [...this.#dirty].sort()) {
			const working = await this.repo.readWorking(path);
			const committed = head.get(path);
			if (working === null) {
				if (committed) out.push({ path, status: 'deleted' });
				else this.#dirty.delete(path);
			} else if (!committed) out.push({ path, status: 'added' });
			else if ((await hash(working)) !== committed) out.push({ path, status: 'modified' });
			else this.#dirty.delete(path);
		}
		await this.#saveDirty();
		return out;
	}

	/** Committed and working text of a file, for a diff. */
	async diff(path: string): Promise<{ before: string | null; after: string | null }> {
		const head = await this.repo.files((p) => p === path);
		const before = head.has(path) ? await this.repo.readBlob(head.get(path)!) : null;
		return { before, after: await this.repo.readWorking(path) };
	}

	/** Commit these paths with the person's message. */
	async commit(paths: readonly string[], message: string): Promise<string> {
		const oid = await this.repo.commitPaths(paths, message);
		for (const p of paths) this.#dirty.delete(p);
		await this.#saveDirty();
		return oid;
	}

	/** Throw away uncommitted edits to a file. Returns its committed text (or `null` if it was new). */
	async discard(path: string): Promise<string | null> {
		await this.repo.discard(path);
		this.#dirty.delete(path);
		await this.#saveDirty();
		return this.repo.readWorking(path);
	}

	aheadBehind() {
		return this.repo.aheadBehind();
	}

	async fetch(onProgress?: (p: LoadProgress) => void) {
		return this.repo.fetch((p) =>
			onProgress?.({ phase: p.phase, ratio: p.total ? p.loaded / p.total : null }),
		);
	}

	/** Pull, refusing to touch files with uncommitted edits. Changed files come back for the vault. */
	async pull(
		resolutions?: Map<string, string>,
		onProgress?: (p: LoadProgress) => void,
	): Promise<WorkspacePull> {
		const result = await this.repo.pull(this.#dirty, resolutions, (p) =>
			onProgress?.({ phase: p.phase, ratio: p.total ? p.loaded / p.total : null }),
		);
		await this.#touchSync(result.status);
		if (result.status !== 'pulled' && result.status !== 'merged') return result;
		const head = await this.repo.files((p) => inVault(this.record.layout, p));
		const changes = await Promise.all(
			result.changed
				.filter((p) => inVault(this.record.layout, p))
				.map(async (path) => ({
					path,
					source: head.has(path) ? await this.repo.readBlob(head.get(path)!) : null,
				})),
		);
		return { status: result.status, changes };
	}

	async push(onProgress?: (p: LoadProgress) => void): Promise<PushResult> {
		const result = await this.repo.push((p) =>
			onProgress?.({ phase: p.phase, ratio: p.total ? p.loaded / p.total : null }),
		);
		await this.#touchSync(result.status);
		return result;
	}

	async #touchSync(status: string) {
		if (
			status === 'conflict' ||
			status === 'unsupported-conflict' ||
			status === 'blocked' ||
			status === 'no-remote'
		)
			return;
		this.record.lastSync = Date.now();
		await db().vaults.update(this.record.id, { lastSync: this.record.lastSync });
	}

	async branches(): Promise<{ current: string; local: string[]; remote: string[] }> {
		const [current, local, remote] = await Promise.all([
			this.repo.branch(),
			this.repo.branches(),
			this.repo.remoteBranches(),
		]);
		return { current, local, remote: remote.filter((b) => !local.includes(b)) };
	}

	/** Switch branches (requires no uncommitted changes). The caller reloads the vault. */
	async switchBranch(name: string): Promise<void> {
		if (this.#dirty.size)
			throw new Error('Commit or discard your changes before switching branches.');
		await this.repo.switchBranch(name);
		await this.updateRecord({ branch: name });
	}

	async createBranch(name: string): Promise<void> {
		await this.repo.createBranch(name);
		await this.updateRecord({ branch: name });
	}

	async updateRecord(patch: Partial<VaultRecord>) {
		Object.assign(this.record, patch);
		this.repo.config = {
			url: this.record.url,
			provider: this.record.provider,
			branch: this.record.branch,
			corsProxy: this.record.corsProxy,
			author: this.record.author,
		};
		await db().vaults.put(this.record);
	}

	/** Drop cached parses, e.g. after the keyword configuration changed. */
	async clearCache(): Promise<void> {
		await db().files.where('vaultId').equals(this.record.id).delete();
	}

	/** Delete the local clone, cache and settings. The remote is untouched. */
	async destroy(): Promise<void> {
		await db().files.where('vaultId').equals(this.record.id).delete();
		await db().vaults.delete(this.record.id);
		fsFor(this.record.id, true);
		await new Promise<void>((resolve) => {
			const req = indexedDB.deleteDatabase(`mycelium-repo-${this.record.id}`);
			req.onsuccess = req.onerror = req.onblocked = () => resolve();
		});
	}
}
