/// A vault that is a folder on this computer, opened with the File System
/// Access API (Chromium-based desktop browsers). Edits are written straight
/// to the files on disk; there's no git here — commit with your own tools.

import { scanFile } from '$lib/org';
import { db, fileKey, requestPersistence, type CachedFile, type VaultRecord } from '$lib/store/db';
import { detectKeywords, detectLayout, inVault } from './layout';
import type { VaultFile } from './vault';
import type { LoadProgress } from '$lib/git/workspace';

type PermissionMode = { mode: 'read' | 'readwrite' };
interface PermissionHandle {
	queryPermission(options: PermissionMode): Promise<PermissionState>;
	requestPermission(options: PermissionMode): Promise<PermissionState>;
}
type DirectoryEntries = AsyncIterable<[string, FileSystemHandle]>;

/** Folders whose contents never belong to the vault. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg']);
const ORG_RE = /\.org$/i;

export const foldersSupported = () =>
	typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Ask the person to pick a folder. Returns `null` if they cancel. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
	try {
		const picker = (
			window as unknown as {
				showDirectoryPicker(o: {
					id?: string;
					mode: 'readwrite';
				}): Promise<FileSystemDirectoryHandle>;
			}
		).showDirectoryPicker;
		return await picker({ id: 'mycelium-vault', mode: 'readwrite' });
	} catch (e) {
		if ((e as DOMException)?.name === 'AbortError') return null;
		throw e;
	}
}

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

export class FolderWorkspace {
	readonly kind = 'folder';

	private constructor(
		public record: VaultRecord,
		readonly root: FileSystemDirectoryHandle,
	) {}

	/** Open a saved folder vault. Its handle may need permission again (see `permission`). */
	static async open(record: VaultRecord): Promise<FolderWorkspace> {
		const saved = await db().handles.get(record.id);
		if (!saved)
			throw new Error(
				'This folder is no longer available. Remove the vault and open the folder again.',
			);
		return new FolderWorkspace(record, saved.handle);
	}

	/** Make a new vault from a folder the person picked. */
	static async create(
		record: VaultRecord,
		root: FileSystemDirectoryHandle,
	): Promise<FolderWorkspace> {
		const ws = new FolderWorkspace(record, root);
		const files = await ws.#walk();
		const sample: { path: string; hasId: boolean }[] = [];
		const texts: string[] = [];
		for (const [path, handle] of files) {
			if (!ORG_RE.test(path)) continue;
			const text = await (await handle.getFile()).text();
			texts.push(text);
			sample.push({ path, hasId: /^[ \t]*:ID:[ \t]+\S/im.test(text) });
		}
		record.layout = detectLayout(sample);
		record.keywords = detectKeywords(texts);
		await db().transaction('rw', db().vaults, db().handles, async () => {
			await db().vaults.put(record);
			await db().handles.put({ id: record.id, handle: root });
		});
		void requestPersistence();
		return ws;
	}

	/** Current permission; `prompt` means `requestAccess()` must run from a click. */
	permission(): Promise<PermissionState> {
		return (this.root as unknown as PermissionHandle).queryPermission({ mode: 'readwrite' });
	}

	async requestAccess(): Promise<boolean> {
		return (
			(await (this.root as unknown as PermissionHandle).requestPermission({
				mode: 'readwrite',
			})) === 'granted'
		);
	}

	/** Every file under the folder (skipping hidden and tooling directories). */
	async #walk(): Promise<Map<string, FileSystemFileHandle>> {
		const out = new Map<string, FileSystemFileHandle>();
		const visit = async (dir: FileSystemDirectoryHandle, prefix: string) => {
			for await (const [name, handle] of (
				dir as unknown as { entries(): DirectoryEntries }
			).entries()) {
				if (handle.kind === 'directory') {
					if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
					await visit(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
				} else out.set(`${prefix}${name}`, handle as FileSystemFileHandle);
			}
		};
		await visit(this.root, '');
		return out;
	}

	/** Read and index the folder's org files, reusing cached parses for unchanged files. */
	async load(onProgress?: (p: LoadProgress) => void): Promise<VaultFile[]> {
		onProgress?.({ phase: 'Reading folder', ratio: null });
		const all = await this.#walk();
		const paths = [...all.keys()].filter((p) => inVault(this.record.layout, p));
		const cached = new Map(
			(await db().files.where('vaultId').equals(this.record.id).toArray()).map((f) => [f.path, f]),
		);
		const out: VaultFile[] = [];
		const fresh: CachedFile[] = [];
		let done = 0;
		for (const path of paths) {
			const file = await all.get(path)!.getFile();
			const oid = `${file.size}:${file.lastModified}`;
			const hit = cached.get(path);
			if (hit && hit.oid === oid) out.push({ path, source: hit.source, index: hit.index });
			else {
				const source = await file.text();
				const index = scanFile(path, source, this.record.keywords);
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
				onProgress?.({ phase: 'Indexing notes', ratio: done / paths.length });
				await yieldToUi();
			}
		}
		const keep = new Set(paths);
		const stale = [...cached.keys()]
			.filter((p) => !keep.has(p))
			.map((p) => fileKey(this.record.id, p));
		await db().transaction('rw', db().files, async () => {
			if (fresh.length) await db().files.bulkPut(fresh);
			if (stale.length) await db().files.bulkDelete(stale);
		});
		return out;
	}

	async #dirFor(path: string, create: boolean): Promise<[FileSystemDirectoryHandle, string]> {
		const parts = path.split('/');
		const name = parts.pop()!;
		let dir = this.root;
		for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
		return [dir, name];
	}

	/** A text file outside the vault's notes (an archive file), or `null`. */
	async readText(path: string): Promise<string | null> {
		const bytes = await this.readBytes(path);
		return bytes ? new TextDecoder().decode(bytes) : null;
	}

	/** A file's bytes (attachments, images), or `null` if it isn't there. */
	async readBytes(path: string): Promise<Uint8Array | null> {
		try {
			const [dir, name] = await this.#dirFor(path, false);
			return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
		} catch {
			return null;
		}
	}

	async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
		const [dir, name] = await this.#dirFor(path, true);
		const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
		await writable.write(bytes as unknown as ArrayBuffer);
		await writable.close();
	}

	/** Write files to disk (or delete them, for `null`). */
	async save(changes: { path: string; source: string | null; file?: VaultFile }[]): Promise<void> {
		for (const c of changes) {
			if (c.source === null) {
				try {
					const [dir, name] = await this.#dirFor(c.path, false);
					await dir.removeEntry(name);
				} catch (e) {
					if ((e as DOMException)?.name !== 'NotFoundError') throw e;
				}
				continue;
			}
			const [dir, name] = await this.#dirFor(c.path, true);
			const handle = await dir.getFileHandle(name, { create: true });
			const writable = await handle.createWritable();
			await writable.write(c.source);
			await writable.close();
		}
		await this.cache(changes);
	}

	async cache(changes: { path: string; source: string | null; file?: VaultFile }[]) {
		for (const c of changes) {
			const key = fileKey(this.record.id, c.path);
			if (c.source === null || !c.file) {
				await db().files.delete(key);
				continue;
			}
			try {
				const [dir, name] = await this.#dirFor(c.path, false);
				const file = await (await dir.getFileHandle(name)).getFile();
				await db().files.put({
					key,
					vaultId: this.record.id,
					path: c.path,
					oid: `${file.size}:${file.lastModified}`,
					source: c.source,
					index: c.file.index,
				});
			} catch {
				await db().files.delete(key);
			}
		}
	}

	async updateRecord(patch: Partial<VaultRecord>) {
		Object.assign(this.record, patch);
		await db().vaults.put(this.record);
	}

	async clearCache(): Promise<void> {
		await db().files.where('vaultId').equals(this.record.id).delete();
	}

	/** Forget the folder. Nothing on disk is touched. */
	async destroy(): Promise<void> {
		await db().files.where('vaultId').equals(this.record.id).delete();
		await db().vaults.delete(this.record.id);
		await db().handles.delete(this.record.id);
	}
}
