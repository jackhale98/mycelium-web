/// Browser persistence (IndexedDB via Dexie): vault settings and a
/// content-addressed cache of parsed files, so reopening a vault only
/// re-indexes files whose git blob changed.

import Dexie, { type EntityTable } from 'dexie';
import type { FileIndex, KeywordConfig, LogSettings } from '$lib/org';
import type { Credentials, ProviderId } from '$lib/git/providers';
import type { Author } from '$lib/git/repo';
import type { VaultLayout } from '$lib/vault/layout';

export interface VaultRecord {
	id: string;
	name: string;
	provider: ProviderId;
	url: string;
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
}

export interface CachedFile {
	/** `${vaultId}\u0000${path}` */
	key: string;
	vaultId: string;
	path: string;
	/** Git blob id of `source`. */
	oid: string;
	source: string;
	index: FileIndex;
}

class MyceliumDB extends Dexie {
	vaults!: EntityTable<VaultRecord, 'id'>;
	files!: EntityTable<CachedFile, 'key'>;

	constructor() {
		super('mycelium');
		this.version(1).stores({
			vaults: 'id',
			files: 'key, vaultId',
		});
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
