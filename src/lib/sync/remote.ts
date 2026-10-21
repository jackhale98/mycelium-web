/// What two-way sync needs from a file service (Dropbox, OneDrive, WebDAV),
/// and the errors every client reports in the same way.

export interface RemoteEntry {
	tag: 'file' | 'folder' | 'deleted';
	/** Absolute in the service, original case: `/Notes/inbox.org`. */
	path: string;
	pathLower: string;
	/** Files only: the version, used to detect concurrent changes. */
	rev?: string;
}

export interface RemoteListing {
	entries: RemoteEntry[];
	cursor: string;
	/**
	 * `entries` is everything under the folder now (not changes since a
	 * cursor), so anything missing from it was deleted.
	 */
	complete?: boolean;
}

/** One service's files. Paths are absolute: the vault folder plus the file's path in it. */
export interface RemoteFiles {
	/** Every file under `path`, or what changed since `cursor`. */
	listAll(start: { path: string } | { cursor: string }): Promise<RemoteListing>;
	download(path: string): Promise<{ text: string; rev: string }>;
	/**
	 * Write a file. With `rev`, only if the service still has that version
	 * (else `RemoteConflict`); without, only if the file doesn't exist yet.
	 */
	upload(path: string, text: string, rev: string | null): Promise<{ rev: string }>;
	/** Delete a file; with `rev`, only if it's still that version. Missing files are fine. */
	delete(path: string, rev: string | null): Promise<void>;
}

/** A folder for the folder picker. */
export interface RemoteFolder {
	name: string;
	path: string;
}

export interface RemoteBrowser {
	/** Subfolders of `path` (`''`: the top), and how many org files are directly in it. */
	browse(path: string): Promise<{ folders: RemoteFolder[]; orgFiles: number }>;
}

/** An upload or delete found the file changed since the version it was based on. */
export class RemoteConflict extends Error {
	constructor(readonly path: string) {
		super(`${path} changed elsewhere`);
	}
}

/** The file (or folder) isn't there. */
export class RemoteNotFound extends Error {
	constructor(readonly path: string) {
		super(`${path} not found`);
	}
}

/** The change cursor is too old: list everything again. */
export class CursorExpired extends Error {
	constructor() {
		super('Change cursor expired');
	}
}

/** Signed out, or the sign-in or password was refused. */
export class RemoteAuthError extends Error {}

/** Any other failure, with the HTTP status. */
export class RemoteError extends Error {
	constructor(
		readonly status: number,
		readonly summary: string,
		service = 'The server',
	) {
		super(`${service}: ${summary || `HTTP ${status}`}`);
	}
}

/** Run `task` over `items`, a few at a time. */
export async function pool<T>(items: T[], size: number, task: (item: T) => Promise<void>) {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(size, items.length) }, async () => {
			while (next < items.length) await task(items[next++]!);
		}),
	);
}

/** Org files, outside hidden folders (`.git`, `.trash`…). */
export const syncable = (path: string) =>
	/\.org$/i.test(path) && !path.split('/').some((part) => part.startsWith('.'));
