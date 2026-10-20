/// Application state shared across views. The vault is a mutable model, so a
/// revision counter tells Svelte when derived views must recompute.
///
/// Two kinds of vault exist: the bundled demo (edits stay in memory) and git
/// vaults (every edit is a local commit; Sync pulls, merges and pushes). The
/// git code is loaded on demand so the landing page and demo stay light.

import {
	appendToFile,
	applyChanges,
	captureEntry,
	changeTodoState,
	detectLogSettings,
	newNodeSource,
	parseOrg,
	toggleCheckbox,
	type KeywordConfig,
	type LogSettings,
	type OrgData,
} from '$lib/org';
import type { FileConflict, LoadProgress, Workspace } from '$lib/git/workspace';
import type { VaultRecord } from '$lib/store/db';
import { dailyDate, dailyPath, DEFAULT_LAYOUT, type VaultLayout } from '$lib/vault/layout';
import { buildSearch } from '$lib/vault/search';
import { Vault } from '$lib/vault/vault';
import { demoSources } from './demo';

export type ThemeChoice = 'system' | 'light' | 'dark';

const THEME_KEY = 'mycelium:theme';
const ACTIVE_KEY = 'mycelium:active-vault';
export const DEMO_ID = 'demo';
const DEMO_KEYWORDS: KeywordConfig = { todoKeywords: ['TODO', 'NEXT'], doneKeywords: ['DONE'] };

function readLocal(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeLocal(key: string, value: string | null) {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		/* storage unavailable: preference is per session */
	}
}

function readTheme(): ThemeChoice {
	const t = readLocal(THEME_KEY);
	return t === 'light' || t === 'dark' ? t : 'system';
}

/** Local date and time, as org writes them. */
export function localNow(): { date: string; time: string } {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return {
		date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
		time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
	};
}

export type SyncState =
	| { kind: 'idle' }
	| { kind: 'busy'; phase: string }
	| { kind: 'conflict'; conflicts: FileConflict[] }
	| { kind: 'error'; message: string }
	| { kind: 'done'; message: string };

export interface ConnectInput {
	url: string;
	provider: VaultRecord['provider'];
	slug: string;
	branch: string | null;
	token: string;
	username: string;
	corsProxy: string | null;
	author: VaultRecord['author'];
}

class AppState {
	vault: Vault = $state.raw(Vault.fromSources(demoSources, DEMO_KEYWORDS));
	/** Bumped on every vault change. */
	rev = $state(0);
	theme = $state<ThemeChoice>(readTheme());
	paletteOpen = $state(false);
	panelOpen = $state(true);
	navOpen = $state(false);

	workspace: Workspace | null = $state.raw(null);
	vaults = $state<VaultRecord[]>([]);
	activeId = $state<string>(DEMO_ID);
	layout = $state<VaultLayout>(DEFAULT_LAYOUT);
	logSettings: LogSettings = $state(detectLogSettings(Object.values(demoSources)));
	/** Non-null while a vault is being cloned or indexed. */
	loading = $state<LoadProgress | null>(null);
	loadError = $state<string | null>(null);
	sync = $state<SyncState>({ kind: 'idle' });
	/** Local commits not yet pushed (git vaults) or edited paths (demo). */
	unsynced = $state(0);
	ready = $state(false);

	#saving: Promise<void> = Promise.resolve();
	#search = $derived.by(() => {
		void this.rev;
		return buildSearch(this.vault);
	});
	#trees = new Map<string, { source: string; tree: OrgData }>();

	get demo() {
		return this.workspace === null;
	}

	get search() {
		return this.#search;
	}

	get activeVault(): VaultRecord | null {
		return this.vaults.find((v) => v.id === this.activeId) ?? null;
	}

	/** Restore the last-used vault. */
	async init() {
		try {
			const { db } = await import('$lib/store/db');
			this.vaults = await db().vaults.toArray();
		} catch {
			this.vaults = [];
		}
		const active = readLocal(ACTIVE_KEY);
		if (active && active !== DEMO_ID && this.vaults.some((v) => v.id === active))
			await this.openVault(active);
		this.ready = true;
	}

	/** Parsed tree for a file, cached by content. */
	tree(path: string): OrgData | null {
		const file = this.vault.file(path);
		if (!file) return null;
		const cached = this.#trees.get(path);
		if (cached && cached.source === file.source) return cached.tree;
		const tree = parseOrg(file.source, file.index.keywords);
		this.#trees.set(path, { source: file.source, tree });
		return tree;
	}

	setTheme(choice: ThemeChoice) {
		this.theme = choice;
		writeLocal(THEME_KEY, choice === 'system' ? null : choice);
		if (choice === 'system') delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = choice;
	}

	// ------------------------------------------------------------------ vaults

	useDemo() {
		this.workspace = null;
		this.activeId = DEMO_ID;
		this.layout = DEFAULT_LAYOUT;
		this.vault = Vault.fromSources(demoSources, DEMO_KEYWORDS);
		this.logSettings = detectLogSettings(Object.values(demoSources));
		this.unsynced = 0;
		this.sync = { kind: 'idle' };
		this.#trees.clear();
		writeLocal(ACTIVE_KEY, DEMO_ID);
		this.rev += 1;
	}

	async openVault(id: string) {
		const record = this.vaults.find((v) => v.id === id);
		if (!record) return;
		this.loadError = null;
		this.loading = { phase: 'Opening vault', ratio: null };
		try {
			const { Workspace } = await import('$lib/git/workspace');
			const ws = Workspace.open($state.snapshot(record) as VaultRecord);
			await this.#activate(ws);
		} catch (e) {
			this.loadError = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = null;
		}
	}

	/** Clone a repository as a new vault and switch to it. */
	async connect(input: ConnectInput): Promise<boolean> {
		this.loadError = null;
		this.loading = { phase: 'Connecting', ratio: null };
		try {
			const { Workspace } = await import('$lib/git/workspace');
			const record: VaultRecord = {
				id: crypto.randomUUID(),
				name: input.slug,
				provider: input.provider,
				url: input.url,
				branch: input.branch,
				corsProxy: input.corsProxy,
				author: input.author,
				credentials: input.token
					? { token: input.token, username: input.username || undefined }
					: null,
				layout: DEFAULT_LAYOUT,
				keywords: DEMO_KEYWORDS,
				log: {},
				createdAt: Date.now(),
				lastSync: Date.now(),
			};
			const ws = await Workspace.create(
				record,
				(p) => (this.loading = { ...p, phase: `Cloning · ${p.phase}` }),
			);
			this.vaults = [...this.vaults, ws.record];
			await this.#activate(ws);
			return true;
		} catch (e) {
			this.loadError = describeGitError(e);
			return false;
		} finally {
			this.loading = null;
		}
	}

	async #activate(ws: Workspace) {
		const files = await ws.load((p) => (this.loading = p));
		const vault = Vault.fromIndexed(files, ws.record.keywords);
		this.workspace = ws;
		this.activeId = ws.record.id;
		this.layout = ws.record.layout;
		this.vault = vault;
		this.logSettings = { ...detectLogSettings(files.map((f) => f.source)), ...ws.record.log };
		this.#trees.clear();
		this.sync = { kind: 'idle' };
		this.unsynced = await ws.unpushed();
		writeLocal(ACTIVE_KEY, ws.record.id);
		this.rev += 1;
	}

	async updateVault(patch: Partial<VaultRecord>) {
		if (!this.workspace) return;
		await this.workspace.updateRecord(patch);
		this.vaults = this.vaults.map((v) =>
			v.id === this.workspace!.record.id ? { ...this.workspace!.record } : v,
		);
		if (patch.keywords) await this.workspace.clearCache();
		if (patch.layout || patch.keywords) await this.openVault(this.workspace.record.id);
		if (patch.log) this.logSettings = { ...this.logSettings, ...patch.log };
	}

	/** Remove a vault's local copy. Unsynced commits are lost; the remote is untouched. */
	async removeVault(id: string) {
		const record = this.vaults.find((v) => v.id === id);
		if (!record) return;
		const { Workspace } = await import('$lib/git/workspace');
		const ws =
			this.workspace?.record.id === id
				? this.workspace
				: Workspace.open($state.snapshot(record) as VaultRecord);
		await ws.destroy();
		this.vaults = this.vaults.filter((v) => v.id !== id);
		if (this.activeId === id) this.useDemo();
	}

	// ------------------------------------------------------------------ edits

	/** Apply a new file text: update the model now, commit in the background. */
	#write(path: string, text: string | null, message: string) {
		const [file] = this.vault.apply([{ path, source: text }]);
		this.rev += 1;
		const ws = this.workspace;
		if (!ws) {
			this.unsynced += 1;
			return;
		}
		this.#saving = this.#saving
			.then(async () => {
				await ws.save([{ path, source: text, ...(file ? { file } : {}) }], message);
				this.unsynced = await ws.unpushed();
			})
			.catch((e) => {
				this.sync = { kind: 'error', message: `Could not save ${path}: ${describeGitError(e)}` };
			});
	}

	/** Resolves once every pending save has been committed. */
	flush(): Promise<void> {
		return this.#saving;
	}

	dailyPath(date: string): string {
		return dailyPath(this.layout, date);
	}

	/** Daily note dates present in the vault, newest first. */
	get dailies(): string[] {
		void this.rev;
		return [...this.vault.files.keys()]
			.map((p) => dailyDate(this.layout, p))
			.filter((d): d is string => d !== null)
			.sort()
			.reverse();
	}

	isDaily(path: string): boolean {
		return dailyDate(this.layout, path) !== null;
	}

	/** Create the daily note for `date` if missing; returns its node id. */
	ensureDaily(date: string): string | null {
		const path = this.dailyPath(date);
		if (!this.vault.file(path))
			this.#write(path, newNodeSource(date, crypto.randomUUID()), `Create daily note ${date}`);
		return this.vault.fileNode(path)?.id ?? null;
	}

	/** Append a capture to today's daily note. */
	capture(text: string): string | null {
		if (!text.trim()) return null;
		const { date } = localNow();
		const id = this.ensureDaily(date);
		const path = this.dailyPath(date);
		const file = this.vault.file(path)!;
		this.#write(
			path,
			applyChanges(file.source, appendToFile(file.source, captureEntry(text))),
			`Capture to ${date}`,
		);
		return id;
	}

	toggleCheckbox(path: string, offset: number) {
		const file = this.vault.file(path);
		if (!file) return;
		const result = toggleCheckbox(file.source, offset);
		if (result.steps.length > 0)
			this.#write(path, result.text, `Update checklist in ${this.#title(path)}`);
	}

	setTodo(path: string, offset: number, keyword: string | null) {
		const file = this.vault.file(path);
		if (!file) return;
		const result = changeTodoState(file.source, offset, keyword, {
			config: file.index.keywords,
			now: localNow(),
			log: this.logSettings,
		});
		if (result.steps.length === 0) return;
		const heading = file.index.headlines.find((h) => h.pos === offset)?.title ?? this.#title(path);
		this.#write(
			path,
			result.text,
			`${result.repeated ? 'Repeat' : (result.keyword ?? 'Clear state')}: ${heading}`,
		);
	}

	#title(path: string) {
		return this.vault.file(path)?.index.title ?? path;
	}

	// ------------------------------------------------------------------ sync

	async syncNow(resolutions?: Map<string, string>) {
		const ws = this.workspace;
		if (!ws || this.sync.kind === 'busy') return;
		this.sync = { kind: 'busy', phase: 'Saving' };
		try {
			await this.flush();
			const result = await ws.sync(
				resolutions,
				(p) => (this.sync = { kind: 'busy', phase: p.phase }),
			);
			switch (result.status) {
				case 'conflict':
					this.sync = { kind: 'conflict', conflicts: result.conflicts };
					return;
				case 'unsupported-conflict':
					this.sync = {
						kind: 'error',
						message: `A file was deleted on one side and edited on the other: ${result.paths.join(', ')}. Resolve it with another git client, then sync again.`,
					};
					return;
				case 'pulled':
				case 'merged': {
					const files = this.vault.apply(result.changes);
					await ws.cache(
						result.changes.map((c) => ({
							...c,
							...(files.find((f) => f.path === c.path)
								? { file: files.find((f) => f.path === c.path)! }
								: {}),
						})),
					);
					this.rev += 1;
					this.sync = {
						kind: 'done',
						message: `${result.status === 'merged' ? 'Merged' : 'Pulled'} ${result.changes.length} ${result.changes.length === 1 ? 'file' : 'files'}`,
					};
					break;
				}
				case 'pushed':
					this.sync = {
						kind: 'done',
						message: `Pushed ${result.commits} ${result.commits === 1 ? 'change' : 'changes'}`,
					};
					break;
				default:
					this.sync = { kind: 'done', message: 'Up to date' };
			}
			this.unsynced = await ws.unpushed();
			this.vaults = this.vaults.map((v) => (v.id === ws.record.id ? { ...ws.record } : v));
		} catch (e) {
			const readOnly =
				!ws.record.credentials && (e as { code?: string }).code === 'UserCanceledError';
			this.sync = {
				kind: 'error',
				message: readOnly
					? 'This vault is read-only, so your changes are saved here but not pushed. Add an access token in Settings to sync them.'
					: describeGitError(e),
			};
			this.unsynced = await ws.unpushed().catch(() => this.unsynced);
		}
	}

	dismissSync() {
		if (this.sync.kind !== 'busy') this.sync = { kind: 'idle' };
	}
}

/** Turn isomorphic-git and network failures into something a person can act on. */
export function describeGitError(e: unknown): string {
	const err = e as { code?: string; message?: string; data?: { statusCode?: number } };
	const status = err?.data?.statusCode;
	if (err?.code === 'HttpError' && (status === 401 || status === 403))
		return 'The git host refused access. Check the repository URL and that your token can read (and write) it.';
	if (err?.code === 'HttpError' && status === 404)
		return 'Repository not found. Check the URL, or add a token for private repositories.';
	if (err?.code === 'UserCanceledError')
		return 'Authentication is required. Add an access token for this repository.';
	if (err?.code === 'PushRejectedError')
		return 'The remote changed while syncing. Sync again to merge.';
	if (err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError'))
		return 'Could not reach the git host or sync proxy. Check your connection and the proxy in Settings.';
	return err?.message ?? String(e);
}

export const app = new AppState();
