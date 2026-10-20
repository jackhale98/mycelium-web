/// A git-backed vault in the browser: repository storage (LightningFS on
/// IndexedDB), the parsed-file cache, and the operations the app performs —
/// load, save (commit) and sync.

import './polyfill';
import LightningFS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { scanFile } from '$lib/org';
import { db, fileKey, requestPersistence, type CachedFile, type VaultRecord } from '$lib/store/db';
import { detectKeywords, detectLayout, inVault } from '$lib/vault/layout';
import type { VaultFile } from '$lib/vault/vault';
import { GitRepo, type FileConflict, type Progress, type SyncResult } from './repo';

const DIR = '/repo';

export interface LoadProgress {
	phase: string;
	/** 0–1 when known. */
	ratio: number | null;
}

export type WorkspaceSync =
	| Exclude<SyncResult, { status: 'pulled' } | { status: 'merged' }>
	| { status: 'pulled' | 'merged'; changes: { path: string; source: string | null }[] };

export type { FileConflict };

function fsFor(id: string, wipe = false) {
	return new LightningFS(`mycelium-repo-${id}`, wipe ? { wipe: true } : undefined);
}

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

export class Workspace {
	readonly repo: GitRepo;

	private constructor(public record: VaultRecord) {
		const fs = fsFor(record.id);
		this.repo = new GitRepo(
			fs,
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

	/** Clone a new vault, detect its layout and save it. */
	static async create(
		record: VaultRecord,
		onProgress?: (p: LoadProgress) => void,
	): Promise<Workspace> {
		const ws = new Workspace(record);
		await ws.#clone(onProgress);
		const files = await ws.repo.files((p) => p.toLowerCase().endsWith('.org'));
		const sample: { path: string; hasId: boolean }[] = [];
		const texts: string[] = [];
		for (const [path, oid] of files) {
			const text = await ws.repo.readBlob(oid);
			texts.push(text);
			sample.push({ path, hasId: /^[ \t]*:ID:[ \t]+\S/im.test(text) });
		}
		ws.record.layout = detectLayout(sample);
		ws.record.keywords = detectKeywords(texts);
		ws.record.branch = await ws.repo.branch();
		await db().vaults.put(ws.record);
		void requestPersistence();
		return ws;
	}

	async #clone(onProgress?: (p: LoadProgress) => void) {
		await this.repo.clone((p: Progress) =>
			onProgress?.({ phase: p.phase, ratio: p.total ? p.loaded / p.total : null }),
		);
	}

	/**
	 * Load every org file in the vault, reusing cached parses for unchanged
	 * blobs and indexing the rest.
	 */
	async load(onProgress?: (p: LoadProgress) => void): Promise<VaultFile[]> {
		const keywords = this.record.keywords;
		if (!(await this.repo.isCloned())) await this.#clone(onProgress);
		onProgress?.({ phase: 'Reading notes', ratio: null });
		const files = await this.repo.files((p) => inVault(this.record.layout, p));
		const cached = new Map(
			(await db().files.where('vaultId').equals(this.record.id).toArray()).map((f) => [f.path, f]),
		);
		const out: VaultFile[] = [];
		const fresh: CachedFile[] = [];
		let done = 0;
		for (const [path, oid] of files) {
			const hit = cached.get(path);
			if (hit && hit.oid === oid) {
				out.push({ path, source: hit.source, index: hit.index });
			} else {
				const source = await this.repo.readBlob(oid);
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
				onProgress?.({ phase: 'Indexing notes', ratio: done / files.size });
				await yieldToUi();
			}
		}
		const stale = [...cached.keys()]
			.filter((p) => !files.has(p))
			.map((p) => fileKey(this.record.id, p));
		await db().transaction('rw', db().files, async () => {
			if (fresh.length) await db().files.bulkPut(fresh);
			if (stale.length) await db().files.bulkDelete(stale);
		});
		return out;
	}

	/** Write files as one local commit and refresh the cache. */
	async save(
		changes: { path: string; source: string | null; file?: VaultFile }[],
		message: string,
	): Promise<void> {
		await this.repo.commit(
			changes.map((c) => ({ path: c.path, content: c.source })),
			message,
		);
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
			const { oid } = await git.hashBlob({ object: c.source });
			puts.push({
				key: fileKey(this.record.id, c.path),
				vaultId: this.record.id,
				path: c.path,
				oid,
				source: c.source,
				index: c.file.index,
			});
		}
		if (puts.length) await db().files.bulkPut(puts);
		if (deletes.length) await db().files.bulkDelete(deletes);
	}

	unpushed(): Promise<number> {
		return this.repo.unpushed();
	}

	/** Pull, merge and push. Changed files come back for the vault to apply. */
	async sync(
		resolutions?: Map<string, string>,
		onProgress?: (p: LoadProgress) => void,
	): Promise<WorkspaceSync> {
		const result = await this.repo.sync(resolutions, (p) =>
			onProgress?.({ phase: p.phase, ratio: p.total ? p.loaded / p.total : null }),
		);
		if (result.status !== 'conflict' && result.status !== 'unsupported-conflict') {
			this.record.lastSync = Date.now();
			await db().vaults.update(this.record.id, { lastSync: this.record.lastSync });
		}
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
