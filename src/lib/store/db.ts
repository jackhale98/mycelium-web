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
	/** The demo only: the day its notes were dated for when it was made. */
	demoDay?: string;
	/** The inbox file (relative to the vault): its top-level headings are undecided. */
	inbox?: string;
	/** Keywords that mean "waiting on someone" for the weekly review. */
	waitKeywords?: string[];
	/** The day of the last finished weekly review, `YYYY-MM-DD`. */
	lastReview?: string;
	/** Working hours for the day planner's free-time total, `HH:MM`. */
	workHours?: { start: string; end: string };
	/** Commit every edit immediately with a generated message (off: you write each commit). */
	autoCommit?: boolean;
	/** Chip colour per TODO keyword (defaults come from the keyword's name and kind). */
	keywordTones?: Record<string, KeywordTone>;
	/** Where pictures added from the app are saved (relative to the vault); `images` when unset. */
	imageDir?: string;
	/** Quick capture templates (org-capture style); the defaults apply when unset. */
	captureTemplates?: CaptureTemplate[] | undefined;
	/** Named agenda filters (an encoded filter query each), shown as chips on the agenda. */
	agendaViews?: SavedAgendaView[];
	/** org-stuck-projects: what a project is (a match string) and the keywords that keep it moving. */
	stuckProjects?: { match: string; keywords: string[]; tags?: string[]; regexp?: string };
	/**
	 * `folder`: a directory on this computer opened with the File System Access API (no git here).
	 * `cloud`: a folder in Dropbox, OneDrive/SharePoint or on a WebDAV server, synced
	 * automatically (see `cloud`).
	 */
	kind?: 'git' | 'folder' | 'cloud';
	cloud?: CloudState;
}

export type CloudService = 'dropbox' | 'onedrive' | 'webdav';

/** A cloud vault's connection and sync position. Sign-ins and passwords stay in this browser. */
export interface CloudState {
	service: CloudService;
	/** The vault's folder in the service: `''` (the top) or `/Notes`. */
	root: string;
	/** Where the last sync left off in the service's change list (`null`: never synced). */
	cursor: string | null;
	/** Who's signed in, for display. */
	account: string;
	/** Files edited here and not yet uploaded. */
	pending: string[];
	/** Dropbox and OneDrive: the OAuth sign-in. */
	accessToken?: string | undefined;
	refreshToken?: string | null | undefined;
	expiresAt?: number | null | undefined;
	/** OneDrive: which drive (personal OneDrive or a SharePoint library), and its name. */
	driveId?: string | undefined;
	driveName?: string | undefined;
	/** OneDrive: signed in with SharePoint access (asked for again on reconnecting). */
	sharepoint?: boolean | undefined;
	/** WebDAV: the server address, user name and (app) password. */
	url?: string | undefined;
	username?: string | undefined;
	password?: string | undefined;
	/** WebDAV: the relay for servers that don't allow cross-origin requests (`null`: direct). */
	proxy?: string | null | undefined;
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

/** A binary file fetched from a cloud vault (an image, an attachment), kept for offline use. */
export interface CachedBlob {
	key: string;
	vaultId: string;
	path: string;
	data: Blob;
	fetchedAt: number;
}

class MyceliumDB extends Dexie {
	vaults!: EntityTable<VaultRecord, 'id'>;
	files!: EntityTable<CachedFile, 'key'>;
	handles!: EntityTable<FolderHandle, 'id'>;
	syncbase!: EntityTable<SyncBase, 'key'>;
	blobs!: EntityTable<CachedBlob, 'key'>;

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
		// v5: Dropbox vaults became one kind of cloud vault.
		this.version(5)
			.stores({})
			.upgrade((tx) =>
				tx
					.table('vaults')
					.toCollection()
					.modify((v: Record<string, unknown>) => {
						if (v.kind !== 'dropbox' || !v.dropbox) return;
						v.kind = 'cloud';
						v.cloud = { service: 'dropbox', ...(v.dropbox as object) };
						delete v.dropbox;
					}),
			);
		this.version(6).stores({ blobs: 'key, vaultId' });
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
