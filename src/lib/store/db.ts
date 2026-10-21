/// Browser persistence (IndexedDB via Dexie): vault settings and a
/// content-addressed cache of parsed files, so reopening a vault only
/// re-indexes files whose git blob changed.

import Dexie, { type EntityTable } from 'dexie';
import type { CaptureTemplate, FileIndex, KeywordConfig, LogSettings } from '$lib/org';
import type { Credentials, ProviderId } from '$lib/git/providers';
import type { Author } from '$lib/git/repo';
import type { VaultLayout } from '$lib/vault/layout';

export type KeywordTone = 'todo' | 'next' | 'wait' | 'done' | 'neutral';

export interface VaultRecord {
	id: string;
	name: string;
	provider: ProviderId;
	/** Remote clone URL, or `null` for a local-only repository (the demo). */
	url: string | null;
	branch: string | null;
	corsProxy: string | null;
	author: Author;
	/** Stored only in this browser; sent only to the git host (via the proxy). */
	credentials: Credentials | null;
	layout: VaultLayout;
	/** Global TODO keywords (org-todo-keywords); files' own #+TODO lines still apply. */
	keywords: KeywordConfig;
	/** Logging behaviour; `null` fields are inferred from the vault's files. */
	log: Partial<LogSettings>;
	createdAt: number;
	lastSync: number | null;
	/** Paths with uncommitted edits in the working tree. */
	dirty?: string[];
	/** Commit every edit immediately with a generated message (off: you write each commit). */
	autoCommit?: boolean;
	/** Chip colour per TODO keyword (defaults come from the keyword's name and kind). */
	keywordTones?: Record<string, KeywordTone>;
	/** Quick capture templates (org-capture style); the defaults apply when unset. */
	captureTemplates?: CaptureTemplate[] | undefined;
	/** Named agenda filters (an encoded filter query each), shown as chips on the agenda. */
	agendaViews?: SavedAgendaView[];
	/**
	 * `folder`: a directory on this computer opened with the File System Access API (no git here).
	 * `dropbox`: a Dropbox folder, synced automatically (see `dropbox`).
	 */
	kind?: 'git' | 'folder' | 'dropbox';
	dropbox?: DropboxState;
}

/** A Dropbox vault's connection and sync position. Tokens stay in this browser. */
export interface DropboxState {
	/** The vault's folder in Dropbox: `''` (the app folder or Dropbox root) or `/Notes`. */
	root: string;
	/** Where the last sync left off in Dropbox's change list (`null`: never synced). */
	cursor: string | null;
	account: string;
	accessToken: string;
	refreshToken: string | null;
	expiresAt: number | null;
	/** Files edited here and not yet uploaded. */
	pending: string[];
}

/** The text and revision of a Dropbox file as of the last sync (the base for merging). */
export interface SyncBase {
	key: string;
	vaultId: string;
	path: string;
	rev: string;
	source: string;
}

export interface SavedAgendaView {
	id: string;
	name: string;
	query: string;
}

/** A local folder's directory handle (kept apart so vault records stay plain data). */
export interface FolderHandle {
	id: string;
	handle: FileSystemDirectoryHandle;
}

export interface CachedFile {
	/** `${vaultId}\u0000${path}` */
	key: string;
	vaultId: string;
	path: string;
	/** Git blob id of `source` (for folders: the file's size and modification time). */
	oid: string;
	source: string;
	index: FileIndex;
}

class MyceliumDB extends Dexie {
	vaults!: EntityTable<VaultRecord, 'id'>;
	files!: EntityTable<CachedFile, 'key'>;
	handles!: EntityTable<FolderHandle, 'id'>;
	syncbase!: EntityTable<SyncBase, 'key'>;

	constructor() {
		super('mycelium');
		this.version(1).stores({
			vaults: 'id',
			files: 'key, vaultId',
		});
		this.version(2).stores({ handles: 'id' });
		// v3: headline entries gained category, effort and topPos; re-index once.
		this.version(3)
			.stores({})
			.upgrade((tx) => tx.table('files').clear());
		this.version(4).stores({ syncbase: 'key, vaultId' });
	}
}

let instance: MyceliumDB | null = null;

export function db(): MyceliumDB {
	instance ??= new MyceliumDB();
	return instance;
}

export const fileKey = (vaultId: string, path: string) => `${vaultId}\u0000${path}`;

/** Keep this origin's storage from being evicted under pressure (best effort). */
export async function requestPersistence(): Promise<boolean> {
	try {
		return (
			(await navigator.storage?.persisted?.()) || ((await navigator.storage?.persist?.()) ?? false)
		);
	} catch {
		return false;
	}
}
