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
	url: string;
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

export type SyncResult =
	| { status: 'up-to-date' }
	| { status: 'pushed'; commits: number }
	| { status: 'pulled'; changed: string[] }
	| { status: 'merged'; changed: string[] }
	| { status: 'conflict'; conflicts: FileConflict[] }
	| { status: 'unsupported-conflict'; paths: string[] };

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

	/** Write files and record them as one commit. Returns the new commit id. */
	async commit(changes: FileChange[], message: string): Promise<string> {
		for (const change of changes) {
			const full = `${this.dir}/${change.path}`;
			if (change.content === null) {
				await this.fs.promises.unlink(full).catch(() => undefined);
				await git.remove({ ...this.#local(), filepath: change.path });
			} else {
				await mkdirp(this.fs, full.slice(0, full.lastIndexOf('/')));
				await this.fs.promises.writeFile(full, change.content, 'utf8');
				await git.add({ ...this.#local(), filepath: change.path });
			}
		}
		const oid = await git.commit({ ...this.#local(), message, author: this.#author() });
		await this.flush();
		return oid;
	}

	#author() {
		return { name: this.config.author.name, email: this.config.author.email };
	}

	/** Commits on the current branch that the remote does not have yet. */
	async unpushed(): Promise<number> {
		const branch = await this.branch();
		let remote: string;
		try {
			remote = await git.resolveRef({ ...this.#local(), ref: `refs/remotes/${REMOTE}/${branch}` });
		} catch {
			return (await this.log(200)).length;
		}
		const local = await this.head();
		if (local === remote) return 0;
		const commits = await this.log(500);
		const index = commits.findIndex((c) => c.oid === remote);
		return index === -1 ? commits.length : index;
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

	/**
	 * Bring the branch in line with the remote: fetch, then fast-forward, push,
	 * or merge with an org-aware three-way merge. Conflicting files are
	 * returned for the user to resolve; call again with `resolutions` (path →
	 * final text) to complete the merge.
	 */
	async sync(
		resolutions?: Map<string, string>,
		onProgress?: (p: Progress) => void,
	): Promise<SyncResult> {
		try {
			return await this.#sync(resolutions, onProgress);
		} finally {
			await this.flush();
		}
	}

	async #sync(
		resolutions?: Map<string, string>,
		onProgress?: (p: Progress) => void,
	): Promise<SyncResult> {
		const branch = await this.branch();
		const remoteRef = `refs/remotes/${REMOTE}/${branch}`;
		const progress = (e: { phase: string; loaded: number; total?: number }) =>
			onProgress?.({ phase: e.phase, loaded: e.loaded, total: e.total });

		await git.fetch({
			...this.#net(),
			remote: REMOTE,
			ref: branch,
			singleBranch: true,
			tags: false,
			onProgress: progress,
		});
		const local = await this.head();
		let remote: string | null = null;
		try {
			remote = await git.resolveRef({ ...this.#local(), ref: remoteRef });
		} catch {
			remote = null;
		}

		if (remote === null) return this.#push(branch, progress);
		if (local === remote) return { status: 'up-to-date' };

		const [base] = await git.findMergeBase({ ...this.#local(), oids: [local, remote] });
		if (base === remote) return this.#push(branch, progress);

		if (base === local) {
			await git.merge({
				...this.#local(),
				ours: branch,
				theirs: remoteRef,
				fastForwardOnly: true,
				author: this.#author(),
			});
			const changed = await this.changedPaths(local, remote);
			await git.checkout({
				...this.#local(),
				ref: branch,
				filepaths: changed.length ? changed : undefined,
				force: true,
			});
			return { status: 'pulled', changed };
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
		const merged = await this.head();
		const changed = await this.changedPaths(local, merged);
		await git.checkout({
			...this.#local(),
			ref: branch,
			filepaths: changed.length ? changed : undefined,
			force: true,
		});
		const pushed = await this.#push(branch, progress);
		return pushed.status === 'pushed' ? { status: 'merged', changed } : pushed;
	}

	async #push(
		branch: string,
		onProgress: (e: { phase: string; loaded: number; total?: number }) => void,
	): Promise<SyncResult> {
		const commits = await this.unpushed();
		if (commits === 0) return { status: 'up-to-date' };
		const result = await git.push({ ...this.#net(), remote: REMOTE, ref: branch, onProgress });
		if (!result.ok) throw new Error(result.error ?? 'Push was rejected');
		return { status: 'pushed', commits };
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
