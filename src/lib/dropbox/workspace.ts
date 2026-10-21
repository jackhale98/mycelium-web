/// A vault kept in a Dropbox folder. The notes live in this browser
/// (IndexedDB), so the vault opens and edits offline; `sync()` exchanges
/// changes with Dropbox, merging edits made on other devices.

import { scanFile } from '$lib/org';
import {
	db,
	fileKey,
	requestPersistence,
	type CachedFile,
	type DropboxState,
	type VaultRecord,
} from '$lib/store/db';
import type { LoadProgress } from '$lib/git/workspace';
import { detectKeywords, detectLayout, inVault } from '$lib/vault/layout';
import type { VaultFile } from '$lib/vault/vault';
import { DropboxApi, refreshDropboxToken, type DropboxTokens } from './api';
import { syncDropbox, type Base, type SyncResult } from './sync';

/** Org files, outside hidden folders (`.git`, `.trash`…). */
export const syncable = (path: string) =>
	/\.org$/i.test(path) && !path.split('/').some((part) => part.startsWith('.'));

export interface DropboxSyncOutcome extends Pick<SyncResult, 'conflicts' | 'pulled' | 'pushed'> {
	/** Local files that changed (`null`: deleted), for the open vault to apply. */
	changes: { path: string; source: string | null }[];
}

export class DropboxWorkspace {
	readonly kind = 'dropbox';
	readonly api: DropboxApi;
	#syncing: Promise<unknown> = Promise.resolve();
	/** Paths saved while a sync is running: they stay pending, and sync doesn't overwrite them. */
	#touched = new Set<string>();

	private constructor(
		public record: VaultRecord & { dropbox: DropboxState },
		readonly appKey: string,
		fetcher?: typeof fetch,
	) {
		this.api = new DropboxApi((force) => this.#token(force), fetcher);
	}

	static open(record: VaultRecord, appKey: string, fetcher?: typeof fetch): DropboxWorkspace {
		if (!record.dropbox) throw new Error('This vault has no Dropbox connection.');
		return new DropboxWorkspace(record as VaultRecord & { dropbox: DropboxState }, appKey, fetcher);
	}

	/** A new vault from a Dropbox folder: download it, detect its layout, save the record. */
	static async create(
		record: VaultRecord & { dropbox: DropboxState },
		appKey: string,
		onProgress?: (p: LoadProgress) => void,
		fetcher?: typeof fetch,
	): Promise<DropboxWorkspace> {
		const ws = new DropboxWorkspace(record, appKey, fetcher);
		await db().vaults.put(record);
		try {
			await ws.sync(undefined, onProgress);
			const files = await db().files.where('vaultId').equals(record.id).toArray();
			record.layout = detectLayout(
				files.map((f) => ({ path: f.path, hasId: /^[ \t]*:ID:[ \t]+\S/im.test(f.source) })),
			);
			record.keywords = detectKeywords(files.map((f) => f.source));
			// Indexed with the default keywords during download: index again with the vault's own.
			await ws.clearCache();
			await db().vaults.put(record);
		} catch (e) {
			await ws.destroy();
			throw e;
		}
		void requestPersistence();
		return ws;
	}

	/** A valid access token, refreshed shortly before it expires (or when `force`d). */
	#refreshing: Promise<void> | null = null;

	async #token(force = false): Promise<string> {
		const d = this.record.dropbox;
		const stale = d.expiresAt !== null && d.expiresAt - 60_000 < Date.now();
		if ((force || stale) && d.refreshToken) {
			// Parallel requests share one refresh.
			this.#refreshing ??= this.#refresh(d.refreshToken).finally(() => (this.#refreshing = null));
			await this.#refreshing;
		}
		return this.record.dropbox.accessToken;
	}

	async #refresh(refreshToken: string) {
		let next: DropboxTokens;
		try {
			next = await refreshDropboxToken(this.appKey, refreshToken);
		} catch (e) {
			// Offline isn't signed out.
			if (e instanceof TypeError || (e as Error)?.name === 'TimeoutError') throw e;
			throw new Error('Dropbox signed you out. Reconnect Dropbox to keep syncing.');
		}
		await this.#updateDropbox({
			accessToken: next.accessToken,
			refreshToken: next.refreshToken,
			expiresAt: next.expiresAt,
		});
	}

	async #updateDropbox(patch: Partial<DropboxState>) {
		this.record.dropbox = { ...this.record.dropbox, ...patch };
		await db().vaults.put(this.record);
	}

	get pending(): string[] {
		return this.record.dropbox.pending;
	}

	/** The vault's files from this browser's copy (downloading it first if it's never synced). */
	async load(onProgress?: (p: LoadProgress) => void): Promise<VaultFile[]> {
		if (this.record.dropbox.cursor === null) await this.sync(undefined, onProgress);
		onProgress?.({ phase: 'Opening vault', ratio: null });
		const cached = await db().files.where('vaultId').equals(this.record.id).toArray();
		const out: VaultFile[] = [];
		const fresh: CachedFile[] = [];
		for (const f of cached) {
			if (!inVault(this.record.layout, f.path)) continue;
			if (!f.index) {
				const index = scanFile(f.path, f.source, this.record.keywords);
				fresh.push({ ...f, index });
				out.push({ path: f.path, source: f.source, index });
			} else out.push({ path: f.path, source: f.source, index: f.index });
		}
		if (fresh.length) await db().files.bulkPut(fresh);
		return out;
	}

	/** Keep edits in this browser and mark them for upload on the next sync. */
	async save(changes: { path: string; source: string | null; file?: VaultFile }[]): Promise<void> {
		await this.cache(changes);
		const pending = new Set(this.record.dropbox.pending);
		for (const c of changes) {
			pending.add(c.path);
			this.#touched.add(c.path);
		}
		await this.#updateDropbox({ pending: [...pending] });
	}

	async cache(changes: { path: string; source: string | null; file?: VaultFile }[]) {
		await db().transaction('rw', db().files, async () => {
			for (const c of changes) {
				const key = fileKey(this.record.id, c.path);
				if (c.source === null) await db().files.delete(key);
				else
					await db().files.put({
						key,
						vaultId: this.record.id,
						path: c.path,
						oid: '',
						source: c.source,
						index: c.file?.index ?? scanFile(c.path, c.source, this.record.keywords),
					});
			}
		});
	}

	/**
	 * Exchange changes with Dropbox. Runs one at a time; `resolutions` are the
	 * texts chosen for files that conflicted last time.
	 */
	sync(
		resolutions?: Map<string, string>,
		onProgress?: (p: LoadProgress) => void,
	): Promise<DropboxSyncOutcome> {
		const run = this.#syncing.then(() => this.#sync(resolutions, onProgress));
		this.#syncing = run.catch(() => undefined);
		return run;
	}

	async #sync(
		resolutions?: Map<string, string>,
		onProgress?: (p: LoadProgress) => void,
	): Promise<DropboxSyncOutcome> {
		const id = this.record.id;
		this.#touched.clear();
		const result = await syncDropbox({
			api: this.api,
			root: this.record.dropbox.root,
			cursor: this.record.dropbox.cursor,
			pending: this.record.dropbox.pending,
			include: syncable,
			resolutions,
			onProgress: (phase, ratio) => onProgress?.({ phase, ratio }),
			store: {
				local: async (path) => (await db().files.get(fileKey(id, path)))?.source ?? null,
				paths: async () =>
					(await db().files.where('vaultId').equals(id).toArray()).map((f) => f.path),
				bases: async () =>
					new Map(
						(await db().syncbase.where('vaultId').equals(id).toArray()).map((b) => [
							b.path,
							{ rev: b.rev, source: b.source } satisfies Base,
						]),
					),
			},
		});
		// A file saved meanwhile keeps its newer text; the app merges it with what
		// came in (see `changes`) and saves the result, which uploads next time.
		const touched = new Set(this.#touched);
		await this.cache(result.writes.filter((w) => !touched.has(w.path)));
		await db().transaction('rw', db().syncbase, async () => {
			for (const [path, base] of result.bases) {
				const key = fileKey(id, path);
				if (base) await db().syncbase.put({ key, vaultId: id, path, ...base });
				else await db().syncbase.delete(key);
			}
		});
		this.record.lastSync = Date.now();
		await this.#updateDropbox({
			cursor: result.cursor,
			pending: [...new Set([...result.pending, ...touched, ...this.#touched])],
		});
		return {
			changes: result.writes,
			conflicts: result.conflicts,
			pulled: result.pulled,
			pushed: result.pushed,
		};
	}

	/**
	 * Merge the next upload of `path` against `base` instead of the last-synced
	 * text: for an edit that overlapped a change sync just brought in.
	 */
	async rebase(path: string, base: string): Promise<void> {
		const key = fileKey(this.record.id, path);
		await db().syncbase.put({ key, vaultId: this.record.id, path, rev: 'stale', source: base });
		if (!this.record.dropbox.pending.includes(path))
			await this.#updateDropbox({ pending: [...this.record.dropbox.pending, path] });
	}

	async updateRecord(patch: Partial<VaultRecord>) {
		Object.assign(this.record, patch);
		await db().vaults.put(this.record);
	}

	/** Forget parsed indexes (keeping the texts, which may hold edits not yet uploaded). */
	async clearCache(): Promise<void> {
		const files = await db().files.where('vaultId').equals(this.record.id).toArray();
		await db().files.bulkPut(
			files.map((f) => ({ ...f, index: undefined as unknown as CachedFile['index'] })),
		);
	}

	/** Forget the vault here. Dropbox is untouched. */
	async destroy(): Promise<void> {
		const id = this.record.id;
		await db().transaction('rw', db().files, db().syncbase, db().vaults, async () => {
			await db().files.where('vaultId').equals(id).delete();
			await db().syncbase.where('vaultId').equals(id).delete();
			await db().vaults.delete(id);
		});
	}
}
