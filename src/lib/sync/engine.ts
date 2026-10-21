/// Two-way sync between a vault's local copy and a folder in a file service
/// (Dropbox, OneDrive, WebDAV).
///
/// Each file remembers the service's version and the text it last agreed on
/// (its base). A sync first takes what changed remotely since the last cursor:
/// files not edited here are replaced; files edited on both sides get a
/// three-way merge against the base, like git, and only real overlaps come
/// back as conflicts. Then local edits are uploaded against the base's
/// revision, so a write that races another device fails instead of
/// overwriting it, and the next round merges it.

import type { FileConflict } from '$lib/git/repo';
import { mergeText } from '$lib/git/merge';
import {
	CursorExpired,
	pool,
	RemoteConflict,
	RemoteNotFound,
	type RemoteEntry,
	type RemoteFiles,
	type RemoteListing,
} from './remote';

export interface Base {
	rev: string;
	source: string;
}

/** The local side: current texts and the last-synced bases. */
export interface SyncStore {
	/** The local text, or `null` if the file doesn't exist here. */
	local(path: string): Promise<string | null>;
	/** Every local path. */
	paths(): Promise<string[]>;
	bases(): Promise<Map<string, Base>>;
}

export interface SyncInput {
	api: RemoteFiles;
	store: SyncStore;
	/** The vault folder in the service (`''` or `/Notes`). */
	root: string;
	cursor: string | null;
	/** Paths edited here and not yet uploaded. */
	pending: Iterable<string>;
	/** Which paths belong to the vault (e.g. `.org` files under the notes folder). */
	include: (path: string) => boolean;
	/** Texts chosen in the conflict resolver, by path. */
	resolutions?: Map<string, string> | undefined;
	onProgress?: ((phase: string, ratio: number | null) => void) | undefined;
	/** WebDAV servers usually tell `A.org` and `a.org` apart; Dropbox and OneDrive don't. */
	caseSensitive?: boolean | undefined;
}

export interface SyncResult {
	/** Local files to write (`null`: delete). */
	writes: { path: string; source: string | null }[];
	/** Bases to save (`null`: forget). */
	bases: Map<string, Base | null>;
	/** Where the next sync picks up in the service's change list. */
	cursor: string | null;
	pending: string[];
	conflicts: FileConflict[];
	pulled: number;
	pushed: number;
}

export async function syncFolder(input: SyncInput): Promise<SyncResult> {
	const { api, store, root, include } = input;
	const lower = input.caseSensitive ? (p: string) => p : (p: string) => p.toLowerCase();
	const rootLower = lower(root);
	const abs = (path: string) => `${root}/${path}`;
	const progress = input.onProgress ?? (() => undefined);

	const bases = await store.bases();
	const pending = new Set(input.pending);
	const out: SyncResult = {
		writes: [],
		bases: new Map(),
		cursor: input.cursor,
		pending: [],
		conflicts: [],
		pulled: 0,
		pushed: 0,
	};
	const base = (path: string): Base | null =>
		out.bases.has(path) ? out.bases.get(path)! : (bases.get(path) ?? null);
	const local = async (path: string): Promise<string | null> => {
		const written = out.writes.findLast((w) => w.path === path);
		return written ? written.source : store.local(path);
	};

	// Dropbox and OneDrive paths are case-insensitive; keep the spelling this vault already uses.
	const known = new Map<string, string>();
	for (const p of [...bases.keys(), ...(await store.paths()), ...pending]) known.set(lower(p), p);
	const relative = (entry: RemoteEntry): string | null => {
		if (rootLower && !entry.pathLower.startsWith(`${rootLower}/`)) return null;
		const rel = entry.path.slice(root.length + 1);
		return known.get(lower(rel)) ?? rel;
	};

	// ------------------------------------------------------------ pull
	progress('Checking for changes', null);
	let listing: RemoteListing;
	try {
		listing = await api.listAll(input.cursor ? { cursor: input.cursor } : { path: root });
	} catch (e) {
		// An expired cursor: start over from a full listing.
		if (!(e instanceof CursorExpired)) throw e;
		listing = await api.listAll({ path: root });
		listing.complete = true;
	}
	const full = !input.cursor || !!listing.complete;

	const changed: { path: string; entry: RemoteEntry }[] = [];
	const deleted: string[] = [];
	const seen = new Set<string>();
	for (const entry of listing.entries) {
		const path = relative(entry);
		if (path === null || !path) continue;
		if (entry.tag === 'deleted') {
			// A deleted folder takes everything under it.
			const prefix = `${lower(path)}/`;
			for (const p of bases.keys())
				if (lower(p) === lower(path) || lower(p).startsWith(prefix)) deleted.push(p);
			continue;
		}
		if (entry.tag !== 'file' || !include(path)) continue;
		seen.add(lower(path));
		// Our own upload coming back, or nothing new.
		if (bases.get(path)?.rev === entry.rev) continue;
		changed.push({ path, entry });
	}
	// A full listing shows what exists: anything we had that's gone was deleted.
	if (full) for (const p of bases.keys()) if (!seen.has(lower(p))) deleted.push(p);

	/**
	 * Fold the service's version of a file into the local one. Files not edited
	 * here take theirs; edits on both sides are merged against the base.
	 */
	const conflicted = new Set<string>();
	const reconcile = async (path: string, remote: { text: string; rev: string }) => {
		const theirs = { rev: remote.rev, source: remote.text };
		const ours = await local(path);
		if (!pending.has(path) || ours === null) {
			// Not edited here, or deleted here and edited there: keep their version.
			if (ours !== remote.text) out.writes.push({ path, source: remote.text });
			pending.delete(path);
			out.bases.set(path, theirs);
			out.pulled += 1;
			return;
		}
		const resolved = input.resolutions?.get(path);
		const merged =
			resolved !== undefined
				? { clean: true, text: resolved, hunks: [] }
				: mergeText(base(path)?.source ?? '', ours, remote.text);
		if (!merged.clean) {
			// Stays pending against the old base, so every sync offers it again until resolved.
			conflicted.add(path);
			out.conflicts.push({
				path,
				base: base(path)?.source ?? '',
				ours,
				theirs: remote.text,
				hunks: merged.hunks,
			});
			return;
		}
		if (merged.text !== ours) out.writes.push({ path, source: merged.text });
		if (merged.text === remote.text) pending.delete(path);
		out.bases.set(path, theirs);
		out.pulled += 1;
	};

	let done = 0;
	await pool(changed, 6, async ({ path, entry }) => {
		const remote = await api.download(entry.path);
		done += 1;
		if (changed.length > 4) progress('Downloading', done / changed.length);
		await reconcile(path, { text: remote.text, rev: remote.rev || entry.rev! });
	});

	for (const path of new Set(deleted)) {
		if (pending.has(path)) {
			// Edited here, deleted there: keep the edit (it uploads as a new file).
			out.bases.set(path, null);
			continue;
		}
		if ((await local(path)) !== null) {
			out.writes.push({ path, source: null });
			out.pulled += 1;
		}
		out.bases.set(path, null);
	}
	out.cursor = listing.cursor;

	// ------------------------------------------------------------ push
	/** Upload (or delete) one file against its base revision. */
	const push = async (path: string) => {
		const text = await local(path);
		const prior = base(path);
		if (text === null) {
			if (prior) await api.delete(abs(path), prior.rev);
			out.bases.set(path, null);
		} else if (!prior || prior.source !== text) {
			const { rev } = await api.upload(abs(path), text, prior?.rev ?? null);
			out.bases.set(path, { rev, source: text });
		}
		pending.delete(path);
		out.pushed += 1;
	};
	const uploads = [...pending].filter((p) => !conflicted.has(p));
	done = 0;
	await pool(uploads, 4, async (path) => {
		try {
			await push(path);
		} catch (e) {
			if (!(e instanceof RemoteConflict)) throw e;
			// The service has a newer version than our base (another device, or a
			// change since the listing): merge it now and try once more.
			let remote: { text: string; rev: string } | null;
			try {
				remote = await api.download(abs(path));
			} catch (err) {
				if (!(err instanceof RemoteNotFound)) throw err;
				remote = null;
			}
			if (remote) await reconcile(path, remote);
			else out.bases.set(path, null);
			if (pending.has(path) && !conflicted.has(path)) {
				try {
					await push(path);
				} catch (again) {
					if (!(again instanceof RemoteConflict)) throw again;
				}
			}
		}
		done += 1;
		if (uploads.length > 4) progress('Uploading', done / uploads.length);
	});
	out.pending = [...pending];
	return out;
}
