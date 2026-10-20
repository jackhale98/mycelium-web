/// A notes repository checked out in browser storage, driven by isomorphic-git.
///
/// The surface is deliberately small today — clone, commit on save, sync —
/// but it is shaped around ordinary git concepts (refs, commits, history,
/// merge bases) so branches, merges and history views can be added without
/// changing how notes are stored.

import git, {
	Errors,
	TREE,
	type HttpClient,
	type PromiseFsClient,
	type ReadCommitResult,
} from 'isomorphic-git';
import { mergeText, type MergeHunk } from './merge';
import { PROVIDERS, type Credentials, type ProviderId } from './providers';

export interface Author {
	name: string;
	email: string;
}

export interface RepoConfig {
	/** Remote clone URL, or `null` for a local-only repository. */
	url: string | null;
	provider: ProviderId;
	/** Branch to work on; `null` uses the remote's default branch. */
	branch: string | null;
	/** Prefix for git's HTTP requests (see the worker), or `null` for direct. */
	corsProxy: string | null;
	author: Author;
}

export interface Progress {
	phase: string;
	loaded: number;
	total?: number | undefined;
}

export interface FileConflict {
	path: string;
	base: string;
	ours: string;
	theirs: string;
	hunks: MergeHunk[];
}

export type PullResult =
	| { status: 'up-to-date' }
	| { status: 'no-remote' }
	| { status: 'pulled'; changed: string[] }
	| { status: 'merged'; changed: string[] }
	/** The remote changed files that have uncommitted edits here. */
	| { status: 'blocked'; paths: string[] }
	| { status: 'conflict'; conflicts: FileConflict[] }
	| { status: 'unsupported-conflict'; paths: string[] };

export type PushResult =
	{ status: 'up-to-date' } | { status: 'no-remote' } | { status: 'pushed'; commits: number };

export interface FileChange {
	path: string;
	/** New content, or `null` to delete the file. */
	content: string | null;
}

export interface CommitSummary {
	oid: string;
	message: string;
	author: Author & { timestamp: number };
	parents: string[];
}

const REMOTE = 'origin';
const decoder = new TextDecoder();

export class GitRepo {
	/** Shared object cache: makes repeated reads from packfiles fast. */
	#cache = {};

	constructor(
		readonly fs: PromiseFsClient,
		readonly http: HttpClient,
		readonly dir: string,
		public config: RepoConfig,
		private credentials: () => Credentials | null,
	) {}

	#auth() {
		const creds = this.credentials();
		const provider = PROVIDERS[this.config.provider];
		return {
			onAuth: () => (creds ? provider.auth(creds) : { cancel: true }),
			onAuthFailure: () => ({ cancel: true }),
		};
	}

	#net() {
		return {
			fs: this.fs,
			http: this.http,
			dir: this.dir,
			cache: this.#cache,
			...(this.config.corsProxy ? { corsProxy: this.config.corsProxy } : {}),
			...this.#auth(),
		};
	}

	#local() {
		return { fs: this.fs, dir: this.dir, cache: this.#cache };
	}

	/**
	 * Make writes durable. Browser filesystems (LightningFS) persist their file
	 * table lazily; without this a tab closed right after a commit can lose it.
	 */
	async flush(): Promise<void> {
		const promises = this.fs.promises as { flush?: () => Promise<void> };
		await promises.flush?.();
	}

	async branch(): Promise<string> {
		return (
			(await git.currentBranch({ ...this.#local(), fullname: false })) ??
			this.config.branch ??
			'main'
		);
	}

	/** Clone the repository. Full history is kept so it can be browsed later. */
	async clone(onProgress?: (p: Progress) => void): Promise<void> {
		if (!this.config.url) throw new Error('This vault has no remote to clone from');
		await git.clone({
			...this.#net(),
			url: this.config.url,
			...(this.config.branch ? { ref: this.config.branch } : {}),
			singleBranch: true,
			noTags: true,
			onProgress: (e) => onProgress?.({ phase: e.phase, loaded: e.loaded, total: e.total }),
		});
		this.config.branch = await this.branch();
		await this.flush();
	}

	/** Start a local-only repository with an initial commit of `files`. */
	async init(files: FileChange[], message: string): Promise<void> {
		await git.init({ ...this.#local(), defaultBranch: this.config.branch ?? 'main' });
		await this.commit(files, message);
		this.config.branch = await this.branch();
	}

	async isCloned(): Promise<boolean> {
		try {
			await git.resolveRef({ ...this.#local(), ref: 'HEAD' });
			return true;
		} catch {
			return false;
		}
	}

	async head(): Promise<string> {
		return git.resolveRef({ ...this.#local(), ref: 'HEAD' });
	}

	/** Paths and blob ids of every file under HEAD matching `filter`. */
	async files(filter: (path: string) => boolean, ref = 'HEAD'): Promise<Map<string, string>> {
		const out = new Map<string, string>();
		await git.walk({
			...this.#local(),
			trees: [TREE({ ref })],
			map: async (path, [entry]) => {
				if (!entry) return null;
				const type = await entry.type();
				if (type === 'blob' && filter(path)) out.set(path, await entry.oid());
				return true;
			},
		});
		return out;
	}

	async readBlob(oid: string): Promise<string> {
		const { blob } = await git.readBlob({ ...this.#local(), oid });
		return decoder.decode(blob);
	}

	async readFile(path: string): Promise<string> {
		return (await this.fs.promises.readFile(`${this.dir}/${path}`, { encoding: 'utf8' })) as string;
	}

	/** Write files into the working tree (autosave). Nothing is staged or committed. */
	async write(changes: FileChange[]): Promise<void> {
		for (const change of changes) {
			const full = `${this.dir}/${change.path}`;
			if (change.content === null) {
				await this.fs.promises.unlink(full).catch(() => undefined);
			} else {
				await mkdirp(this.fs, full.slice(0, full.lastIndexOf('/')));
				await this.fs.promises.writeFile(full, change.content, 'utf8');
			}
		}
		await this.flush();
	}

	/** The working-tree text of a file, or `null` if it does not exist. */
	async readWorking(path: string): Promise<string | null> {
		try {
			return (await this.fs.promises.readFile(`${this.dir}/${path}`, {
				encoding: 'utf8',
			})) as string;
		} catch {
			return null;
		}
	}

	/** Stage exactly these paths (additions, edits and deletions) and commit them. */
	async commitPaths(paths: readonly string[], message: string): Promise<string> {
		for (const path of paths) {
			if ((await this.readWorking(path)) === null)
				await git.remove({ ...this.#local(), filepath: path });
			else await git.add({ ...this.#local(), filepath: path });
		}
		const oid = await git.commit({ ...this.#local(), message, author: this.#author() });
		await this.flush();
		return oid;
	}

	/** Write files and commit them in one step. Returns the new commit id. */
	async commit(changes: FileChange[], message: string): Promise<string> {
		await this.write(changes);
		return this.commitPaths(
			changes.map((c) => c.path),
			message,
		);
	}

	/** Throw away working-tree changes to a file: restore it from HEAD, or delete it if new. */
	async discard(path: string): Promise<void> {
		const head = await this.files((p) => p === path);
		if (head.has(path)) {
			await this.write([{ path, content: await this.readBlob(head.get(path)!) }]);
		} else {
			await this.write([{ path, content: null }]);
		}
	}

	#author() {
		return { name: this.config.author.name, email: this.config.author.email };
	}

	hasRemote(): boolean {
		return !!this.config.url;
	}

	async #remoteHead(branch: string): Promise<string | null> {
		try {
			return await git.resolveRef({ ...this.#local(), ref: `refs/remotes/${REMOTE}/${branch}` });
		} catch {
			return null;
		}
	}

	/** Commits on the current branch that the remote does not have yet. */
	async unpushed(): Promise<number> {
		return (await this.aheadBehind()).ahead;
	}

	/** Commits only here (`ahead`) and only on the last-fetched remote (`behind`). */
	async aheadBehind(): Promise<{ ahead: number; behind: number }> {
		const branch = await this.branch();
		const remote = await this.#remoteHead(branch);
		const local = await this.head().catch(() => null);
		if (!local) return { ahead: 0, behind: 0 };
		if (!remote) return { ahead: this.hasRemote() ? (await this.log(500)).length : 0, behind: 0 };
		if (remote === local) return { ahead: 0, behind: 0 };
		const ids = async (ref: string) =>
			new Set((await git.log({ ...this.#local(), ref, depth: 500 })).map((c) => c.oid));
		const [mine, theirs] = await Promise.all([ids(local), ids(remote)]);
		let ahead = 0;
		let behind = 0;
		for (const id of mine) if (!theirs.has(id)) ahead += 1;
		for (const id of theirs) if (!mine.has(id)) behind += 1;
		return { ahead, behind };
	}

	/** Recent history, newest first. `path` limits it to one file. */
	async log(depth = 50, path?: string): Promise<CommitSummary[]> {
		let entries: ReadCommitResult[];
		try {
			entries = await git.log({ ...this.#local(), depth, ...(path ? { filepath: path } : {}) });
		} catch (e) {
			if (e instanceof Errors.NotFoundError) return [];
			throw e;
		}
		return entries.map((e) => ({
			oid: e.oid,
			message: e.commit.message.trim(),
			author: {
				name: e.commit.author.name,
				email: e.commit.author.email,
				timestamp: e.commit.author.timestamp,
			},
			parents: e.commit.parent,
		}));
	}

	/** Local branches. */
	async branches(): Promise<string[]> {
		return git.listBranches(this.#local());
	}

	/** Branches on the remote, as of the last fetch. */
	async remoteBranches(): Promise<string[]> {
		return (await git.listBranches({ ...this.#local(), remote: REMOTE })).filter(
			(b) => b !== 'HEAD',
		);
	}

	/** Create a branch at HEAD and switch to it. The working tree is unchanged. */
	async createBranch(name: string): Promise<void> {
		await git.branch({ ...this.#local(), ref: name, checkout: true });
		this.config.branch = name;
		await this.flush();
	}

	/**
	 * Switch branches. Callers must commit or discard changes first; a remote
	 * branch without a local one is fetched and tracked.
	 */
	async switchBranch(name: string): Promise<string[]> {
		const before = await this.head();
		const local = await this.branches();
		if (!local.includes(name) && this.hasRemote()) {
			await git.fetch({
				...this.#net(),
				remote: REMOTE,
				ref: name,
				singleBranch: true,
				tags: false,
			});
		}
		await git.checkout({ ...this.#local(), ref: name, remote: REMOTE, force: true });
		this.config.branch = name;
		await this.flush();
		return this.changedPaths(before, await this.head());
	}

	/** Download remote changes without touching the working tree. */
	async fetch(onProgress?: (p: Progress) => void): Promise<{ ahead: number; behind: number }> {
		if (!this.hasRemote()) return { ahead: 0, behind: 0 };
		const branch = await this.branch();
		await git.fetch({
			...this.#net(),
			remote: REMOTE,
			ref: branch,
			singleBranch: true,
			tags: false,
			onProgress: (e) => onProgress?.({ phase: e.phase, loaded: e.loaded, total: e.total }),
		});
		await this.flush();
		return this.aheadBehind();
	}

	/**
	 * Fetch and integrate the remote branch: fast-forward, or a local merge
	 * commit using the org-aware three-way merge. Never overwrites uncommitted
	 * work: if the remote changed a file listed in `dirty`, nothing happens and
	 * those paths come back as `blocked`. Conflicts come back per file; call
	 * again with `resolutions` (path → final text) to complete the merge.
	 */
	async pull(
		dirty: ReadonlySet<string> = new Set(),
		resolutions?: Map<string, string>,
		onProgress?: (p: Progress) => void,
	): Promise<PullResult> {
		if (!this.hasRemote()) return { status: 'no-remote' };
		try {
			await this.fetch(onProgress);
			const branch = await this.branch();
			const remoteRef = `refs/remotes/${REMOTE}/${branch}`;
			const local = await this.head();
			const remote = await this.#remoteHead(branch);
			if (remote === null || local === remote) return { status: 'up-to-date' };
			const [base] = await git.findMergeBase({ ...this.#local(), oids: [local, remote] });
			if (base === remote) return { status: 'up-to-date' };

			const incoming = await this.changedPaths(base ?? local, remote);
			const blocked = incoming.filter((p) => dirty.has(p));
			if (blocked.length) return { status: 'blocked', paths: blocked };

			if (base === local) {
				await git.merge({
					...this.#local(),
					ours: branch,
					theirs: remoteRef,
					fastForwardOnly: true,
					author: this.#author(),
				});
				await this.#checkout(branch, incoming);
				return { status: 'pulled', changed: incoming };
			}

			try {
				await git.merge({
					...this.#local(),
					ours: branch,
					theirs: remoteRef,
					author: this.#author(),
					message: `Merge ${REMOTE}/${branch}`,
					abortOnConflict: true,
					mergeDriver: ({ contents, path }) => {
						const resolved = resolutions?.get(path);
						if (resolved !== undefined) return { cleanMerge: true, mergedText: resolved };
						const r = mergeText(contents[0] ?? '', contents[1] ?? '', contents[2] ?? '');
						return { cleanMerge: r.clean, mergedText: r.text };
					},
				});
			} catch (e) {
				if (e instanceof Errors.MergeConflictError) {
					const { bothModified, deleteByUs, deleteByTheirs } = e.data;
					if (deleteByUs.length || deleteByTheirs.length) {
						return { status: 'unsupported-conflict', paths: [...deleteByUs, ...deleteByTheirs] };
					}
					return {
						status: 'conflict',
						conflicts: await this.#conflicts(bothModified, base!, local, remote),
					};
				}
				throw e;
			}
			const changed = await this.changedPaths(local, await this.head());
			await this.#checkout(branch, changed);
			return { status: 'merged', changed };
		} finally {
			await this.flush();
		}
	}

	async #checkout(branch: string, paths: string[]) {
		if (paths.length === 0) return;
		await git.checkout({ ...this.#local(), ref: branch, filepaths: paths, force: true });
	}

	/** Push local commits. A rejected push (remote moved on) means: pull first. */
	async push(onProgress?: (p: Progress) => void): Promise<PushResult> {
		if (!this.hasRemote()) return { status: 'no-remote' };
		const branch = await this.branch();
		const { ahead } = await this.aheadBehind();
		if (ahead === 0 && (await this.#remoteHead(branch)) !== null) return { status: 'up-to-date' };
		try {
			const result = await git.push({
				...this.#net(),
				remote: REMOTE,
				ref: branch,
				onProgress: (e) => onProgress?.({ phase: e.phase, loaded: e.loaded, total: e.total }),
			});
			if (!result.ok) throw new Error(result.error ?? 'Push was rejected');
			return { status: 'pushed', commits: ahead };
		} finally {
			await this.flush();
		}
	}

	/** Pull then push: the one-button path. */
	async sync(
		resolutions?: Map<string, string>,
		onProgress?: (p: Progress) => void,
	): Promise<PullResult | PushResult> {
		const pulled = await this.pull(new Set(), resolutions, onProgress);
		if (pulled.status !== 'up-to-date' && pulled.status !== 'pulled' && pulled.status !== 'merged')
			return pulled;
		const pushed = await this.push(onProgress);
		return pulled.status === 'up-to-date' ? pushed : pulled;
	}

	async #conflicts(
		paths: string[],
		base: string,
		ours: string,
		theirs: string,
	): Promise<FileConflict[]> {
		const read = async (oid: string, path: string) => {
			try {
				const { blob } = await git.readBlob({ ...this.#local(), oid, filepath: path });
				return decoder.decode(blob);
			} catch {
				return '';
			}
		};
		return Promise.all(
			paths.map(async (path) => {
				const [b, o, t] = await Promise.all([
					read(base, path),
					read(ours, path),
					read(theirs, path),
				]);
				return { path, base: b, ours: o, theirs: t, hunks: mergeText(b, o, t).hunks };
			}),
		);
	}

	/** Paths whose content differs between two commits. */
	async changedPaths(from: string, to: string): Promise<string[]> {
		const changed: string[] = [];
		await git.walk({
			...this.#local(),
			trees: [TREE({ ref: from }), TREE({ ref: to })],
			map: async (path, [a, b]) => {
				if (path === '.') return true;
				const [ta, tb] = await Promise.all([a?.type(), b?.type()]);
				if (ta === 'tree' || tb === 'tree') return true;
				const [oa, ob] = await Promise.all([a?.oid(), b?.oid()]);
				if (oa !== ob) changed.push(path);
				return true;
			},
		});
		return changed;
	}
}

async function mkdirp(fs: PromiseFsClient, dir: string) {
	const parts = dir.split('/').filter(Boolean);
	let current = '';
	for (const part of parts) {
		current += `/${part}`;
		try {
			await fs.promises.mkdir(current);
		} catch (e) {
			if ((e as { code?: string }).code !== 'EEXIST') throw e;
		}
	}
}
