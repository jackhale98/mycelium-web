/// Application state shared across views. The vault is a mutable model, so a
/// revision counter tells Svelte when derived views must recompute.
///
/// Every vault is a git repository in browser storage — the demo is a local
/// one with no remote. Edits autosave to the working tree; the person reviews
/// changes, writes a commit message, and pulls/pushes when they choose. The
/// git code loads on demand so the first paint stays light.

import {
	applyChanges,
	applyTemplate,
	DEFAULT_CAPTURE_TEMPLATES,
	expandTemplate,
	shapeCapture,
	type CaptureTemplate,
	changeTodoState,
	detectLogSettings,
	newNodeSource,
	parseOrg,
	parseTimestampInput,
	getPlanning,
	roamFileName,
	setHeadlineTags,
	setHeadlineTitle,
	headlineAt,
	archiveLocation,
	archiveSubtree,
	parentHeading,
	updateTodoCookies,
	refileAcross,
	refileWithin,
	clockCancel,
	clockIn,
	clockMillis,
	formatDuration,
	formatTable,
	tableAt,
	type TableRow,
	clockOut,
	runningClocks,
	subtreeClockSum,
	findSearchTarget,
	parseSearchOption,
	splitLines,
	subtreeEnd,
	setPlanning,
	setPriority,
	setProperty,
	getProperty,
	toggleCheckbox,
	setTodoKeyword,
	fileTodoKeywords,
	type KeywordConfig,
	type LogSettings,
	type OrgData,
	type PlanningKind,
	type Change,
} from '$lib/org';
import type { FileConflict, FileStatus, LoadProgress, Workspace } from '$lib/git/workspace';
import type { CloudState, KeywordTone, SavedAgendaView, VaultRecord } from '$lib/store/db';
import type { FolderWorkspace } from '$lib/vault/folder';
import type { CloudWorkspace } from '$lib/sync/workspace';
import { RemoteAuthError, RemoteNotFound } from '$lib/sync/remote';
import { nextCheckDelay, saveDataOn } from '$lib/sync/schedule';
import {
	dailyDate,
	dailyPath,
	DEFAULT_LAYOUT,
	nodePath,
	type VaultLayout,
} from '$lib/vault/layout';
import { buildSearch } from '$lib/vault/search';
import { Vault } from '$lib/vault/vault';
import { demoSources } from './demo';
import { href } from './router.svelte';
import { slugify } from './util';

export type ThemeChoice = 'system' | 'light' | 'dark';

const THEME_KEY = 'mycelium:theme';
const TEXT_SIZE_KEY = 'mycelium:text-size';
const LINE_BREAKS_KEY = 'mycelium:line-breaks';
const HIDE_DONE_KEY = 'mycelium:hide-done';
/** Text-size steps, in percent of the browser's default size. */
export const TEXT_SIZES = [
	{ value: 90, label: 'Small' },
	{ value: 100, label: 'Default' },
	{ value: 112.5, label: 'Large' },
	{ value: 125, label: 'Larger' },
	{ value: 150, label: 'Largest' },
] as const;

function readTextSize(): number {
	const n = Number(readLocal(TEXT_SIZE_KEY));
	return TEXT_SIZES.some((s) => s.value === n) ? n : 100;
}
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

/** Where a capture landed. */
export interface CaptureResult {
	path: string;
	id: string | null;
	label: string;
}

export type SyncState =
	| { kind: 'idle' }
	| { kind: 'busy'; phase: string }
	| { kind: 'conflict'; conflicts: FileConflict[] }
	| { kind: 'error'; message: string }
	| { kind: 'done'; message: string };

export interface CloudSyncStatus {
	state: 'idle' | 'syncing' | 'offline' | 'error';
	/** Files edited here and not yet uploaded. */
	pending: number;
	lastSync: number | null;
	/** Files edited both here and elsewhere, waiting for a choice. */
	conflicts?: number;
	message?: string;
}

type CloudSyncOptions = { auto?: boolean; resolutions?: Map<string, string> | undefined };

/** Wait after an edit before uploading, so typing becomes one upload. */
const CLOUD_EDIT_DELAY = 2500;

export interface GitState {
	branch: string;
	/** Uncommitted changes in the working tree. */
	changes: FileStatus[];
	ahead: number;
	behind: number;
	hasRemote: boolean;
}

export interface ConnectInput {
	url: string;
	provider: VaultRecord['provider'];
	slug: string;
	branch: string | null;
	token: string;
	username: string;
	corsProxy: string | null;
	author: VaultRecord['author'];
	credentials?: VaultRecord['credentials'];
}

function demoRecord(): VaultRecord {
	return {
		id: DEMO_ID,
		name: 'Demo vault',
		provider: 'other',
		url: null,
		branch: 'main',
		corsProxy: null,
		author: { name: 'You', email: 'you@example.com' },
		credentials: null,
		layout: DEFAULT_LAYOUT,
		keywords: DEMO_KEYWORDS,
		log: {},
		createdAt: Date.now(),
		lastSync: null,
		dirty: [],
	};
}

/** The vault opened last time, if it wasn't the demo: start blank and load it, never show the demo meanwhile. */
const resumeId = ((id) => (id && id !== DEMO_ID ? id : null))(readLocal(ACTIVE_KEY));

class AppState {
	vault: Vault = $state.raw(Vault.fromSources(resumeId ? {} : demoSources, DEMO_KEYWORDS));
	/** Bumped on every vault change. */
	rev = $state(0);
	theme = $state<ThemeChoice>(readTheme());
	textSize = $state<number>(readTextSize());
	/**
	 * Show a paragraph's line breaks as written (as Emacs shows the buffer), or
	 * join its lines into flowing text (as org's exporters do), which suits
	 * notes hard-wrapped with M-q.
	 */
	joinLines = $state(readLocal(LINE_BREAKS_KEY) === 'join');
	/** Reading view leaves out headings marked with a done keyword (and what's under them). */
	hideDone = $state(readLocal(HIDE_DONE_KEY) === '1');
	paletteOpen = $state(false);
	panelOpen = $state(true);
	navOpen = $state(false);
	/** Notes open in the source editor instead of the reading view. */
	editing = $state(false);
	/** Where the editor should put the cursor when it next opens (a heading's offset). */
	editAt = $state<number | null>(null);
	/** The heading open in the heading sheet, if any. */
	headingSheet = $state<{ path: string; pos: number } | null>(null);
	/** The quick capture sheet: open with a template chosen, and text to start from. */
	captureSheet = $state<{ templateId?: string; text?: string } | null>(null);
	/** "Saved to …" after a capture, with the note to open. */
	captureNotice = $state<{ label: string; id: string | null; path: string } | null>(null);
	/** Open the new-note dialog, optionally with a title. */
	newNote = $state<{ title: string } | null>(null);

	/** The open git vault (also the demo), if any. */
	workspace: Workspace | null = $state.raw(null);
	/** The open local-folder vault, if any. */
	folder: FolderWorkspace | null = $state.raw(null);
	/** The open cloud vault (Dropbox, OneDrive, WebDAV), if any. */
	cloud: CloudWorkspace | null = $state.raw(null);
	/** Cloud sync status, for the sidebar and Changes page. */
	cloudSync = $state<CloudSyncStatus>({ state: 'idle', pending: 0, lastSync: null });
	/** A folder vault waiting for the person to grant access again (needs a click). */
	folderAccess = $state<{ id: string; name: string } | null>(null);
	vaults = $state<VaultRecord[]>([]);
	activeId = $state<string>(resumeId ?? DEMO_ID);
	layout = $state<VaultLayout>(DEFAULT_LAYOUT);
	logSettings: LogSettings = $state(detectLogSettings(Object.values(demoSources)));
	/** Non-null while a vault is being cloned or indexed. */
	loading = $state<LoadProgress | null>(resumeId ? { phase: 'Opening vault', ratio: null } : null);
	/** Cloning a new repository: shown in the Vaults form, which stays on screen so a failure keeps what was typed. */
	connecting = $state<LoadProgress | null>(null);
	loadError = $state<string | null>(null);
	sync = $state<SyncState>({ kind: 'idle' });
	git = $state<GitState>({ branch: 'main', changes: [], ahead: 0, behind: 0, hasRemote: false });
	ready = $state(false);

	#saving: Promise<void> = Promise.resolve();
	#cloudTimer: ReturnType<typeof setTimeout> | null = null;
	/** Counts edits, so a sync can tell whether any were made while it ran. */
	#edits = 0;
	#statusTimer: ReturnType<typeof setTimeout> | null = null;
	#search = $derived.by(() => {
		void this.rev;
		return buildSearch(this.vault);
	});
	#trees = new Map<string, { source: string; tree: OrgData }>();

	/** Whichever kind of vault is open. */
	get #ws(): Workspace | FolderWorkspace | CloudWorkspace | null {
		return this.workspace ?? this.folder ?? this.cloud;
	}

	get demo() {
		return this.activeId === DEMO_ID;
	}

	get search() {
		return this.#search;
	}

	/** Chip colours chosen for TODO keywords in this vault. */
	get keywordTones(): Record<string, KeywordTone> {
		return this.activeVault?.keywordTones ?? {};
	}

	/**
	 * How keywords are used: headings per configured keyword, frequent
	 * heading-starting words that aren't keywords yet, and files that set
	 * their own `#+TODO:` (and so ignore the vault's keywords).
	 */
	keywordUsage() {
		void this.rev;
		const counts = new Map<string, number>();
		const words = new Map<string, number>();
		const ownFiles: string[] = [];
		const known = new Set([
			...this.vault.keywords.todoKeywords,
			...this.vault.keywords.doneKeywords,
		]);
		const re = /^\*+[ \t]+([A-Z][A-Z_-]{1,})(?=[ \t]|$)/gm;
		for (const file of this.vault.files.values()) {
			if (fileTodoKeywords(file.source)) ownFiles.push(file.path);
			for (const h of file.index.headlines)
				if (h.todo) counts.set(h.todo, (counts.get(h.todo) ?? 0) + 1);
			re.lastIndex = 0;
			for (let m = re.exec(file.source); m; m = re.exec(file.source))
				if (!known.has(m[1]!)) words.set(m[1]!, (words.get(m[1]!) ?? 0) + 1);
		}
		const candidates = [...words.entries()]
			.filter(([, n]) => n >= 2)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8);
		return { counts, candidates, ownFiles: ownFiles.sort() };
	}

	/** Save the vault's TODO keywords (and chip colours) and re-index with them. */
	async saveKeywords(keywords: KeywordConfig, tones: Record<string, KeywordTone>) {
		const ws = this.#ws;
		const snapshot = JSON.parse(JSON.stringify(keywords)) as KeywordConfig;
		if (ws) {
			await ws.updateRecord({ keywords: snapshot, keywordTones: { ...tones } });
			await ws.clearCache();
			this.vaults = this.vaults.map((v) => (v.id === ws.record.id ? { ...ws.record } : v));
		}
		const sources = Object.fromEntries([...this.vault.files].map(([p, f]) => [p, f.source]));
		this.vault = Vault.fromSources(sources, snapshot);
		this.#trees.clear();
		this.rev += 1;
	}

	/**
	 * Rename a keyword on every heading that uses it, in files that follow the
	 * vault's keywords (files with their own `#+TODO:` are left alone). The
	 * edits are ordinary uncommitted changes. Returns what was changed.
	 */
	renameKeyword(from: string, to: string): { files: number; headings: number } {
		let files = 0;
		let headings = 0;
		for (const file of [...this.vault.files.values()]) {
			if (fileTodoKeywords(file.source)) continue;
			const heads = file.index.headlines.filter((h) => h.todo === from);
			if (!heads.length) continue;
			const changes = heads.flatMap((h) =>
				setTodoKeyword(file.source, h.pos, to, file.index.keywords),
			);
			this.#write(
				file.path,
				applyChanges(file.source, changes),
				`Rename TODO keyword ${from} → ${to}`,
			);
			files += 1;
			headings += heads.length;
		}
		return { files, headings };
	}

	get activeVault(): VaultRecord | null {
		return this.vaults.find((v) => v.id === this.activeId) ?? null;
	}

	/** Things not yet pushed: uncommitted files plus local commits (or cloud uploads). */
	get unsynced(): number {
		if (this.cloud) return this.cloudSync.pending;
		return this.git.changes.length + this.git.ahead;
	}

	/** Restore the last-used vault (the demo by default). */
	async init() {
		try {
			const { db } = await import('$lib/store/db');
			this.vaults = await db().vaults.toArray();
		} catch {
			this.vaults = [];
		}
		const active = readLocal(ACTIVE_KEY);
		if (active && active !== DEMO_ID && this.vaults.some((v) => v.id === active))
			// On failure (or a folder awaiting access) the vault stays blank with a notice:
			// never the demo, which would look like part of this vault.
			await this.openVault(active);
		else {
			if (resumeId) this.#showDemo();
			// The in-memory demo is on screen unless we came from another vault.
			if (this.vaults.some((v) => v.id === DEMO_ID)) await this.openDemo({ quiet: !resumeId });
			else this.#startDemo();
		}
		this.loading = null;
		this.ready = true;
		this.#watchCloud();
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

	setTextSize(size: number) {
		this.textSize = size;
		writeLocal(TEXT_SIZE_KEY, size === 100 ? null : String(size));
		if (size === 100) document.documentElement.style.removeProperty('--text-scale');
		else document.documentElement.style.setProperty('--text-scale', `${size}%`);
	}

	setHideDone(hide: boolean) {
		this.hideDone = hide;
		writeLocal(HIDE_DONE_KEY, hide ? '1' : null);
	}

	setJoinLines(join: boolean) {
		this.joinLines = join;
		writeLocal(LINE_BREAKS_KEY, join ? 'join' : null);
		if (join) document.documentElement.dataset.lineBreaks = 'join';
		else delete document.documentElement.dataset.lineBreaks;
	}

	/** Step the text size up or down (`0` resets). */
	stepTextSize(direction: -1 | 0 | 1) {
		if (direction === 0) return this.setTextSize(100);
		const i = TEXT_SIZES.findIndex((s) => s.value === this.textSize);
		const next = TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, i + direction))]!;
		this.setTextSize(next.value);
	}

	setTheme(choice: ThemeChoice) {
		this.theme = choice;
		writeLocal(THEME_KEY, choice === 'system' ? null : choice);
		if (choice === 'system') delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = choice;
	}

	// ------------------------------------------------------------------ vaults

	/** Open the demo: a local git repository (no remote) seeded with the demo notes. */
	/**
	 * Open the demo's stored repository. `quiet` skips the loading screen, for when the
	 * in-memory demo is already on screen: swapping pages for the loader would rebuild them
	 * and lose whatever someone had started typing.
	 */
	async openDemo(options: { quiet?: boolean } = {}) {
		try {
			const { Workspace } = await import('$lib/git/workspace');
			const existing = this.vaults.find((v) => v.id === DEMO_ID);
			const ws = existing
				? Workspace.open($state.snapshot(existing) as VaultRecord)
				: await Workspace.createLocal(demoRecord(), demoSources, 'Demo vault');
			if (!existing) this.vaults = [...this.vaults, ws.record];
			await this.#activate(ws, options);
		} catch (e) {
			// No IndexedDB (e.g. some private windows): the demo still works in memory.
			console.warn('Demo vault falling back to memory:', e);
			this.workspace = null;
			this.activeId = DEMO_ID;
			this.layout = DEFAULT_LAYOUT;
			this.vault = Vault.fromSources(demoSources, DEMO_KEYWORDS);
			this.rev += 1;
		} finally {
			this.loading = null;
		}
		writeLocal(ACTIVE_KEY, DEMO_ID);
	}

	/** Put the in-memory demo on screen (the last vault is gone). */
	#showDemo() {
		this.workspace = null;
		this.folder = null;
		this.cloud = null;
		this.activeId = DEMO_ID;
		this.layout = DEFAULT_LAYOUT;
		this.vault = Vault.fromSources(demoSources, DEMO_KEYWORDS);
		this.rev += 1;
	}

	#demoReady: Promise<void> | null = null;

	/**
	 * First visit: the in-memory demo is already on screen, so build its git
	 * repository when the browser is idle instead of during startup.
	 */
	#startDemo() {
		writeLocal(ACTIVE_KEY, DEMO_ID);
		const idle = (cb: () => void) =>
			'requestIdleCallback' in window
				? requestIdleCallback(cb, { timeout: 4000 })
				: setTimeout(cb, 1200);
		this.#demoReady = new Promise<void>((resolve) =>
			idle(() => void this.#attachDemo().finally(resolve)),
		);
	}

	async #attachDemo() {
		try {
			const { Workspace } = await import('$lib/git/workspace');
			const ws = await Workspace.createLocal(demoRecord(), demoSources, 'Demo vault');
			this.vaults = [...this.vaults.filter((v) => v.id !== DEMO_ID), ws.record];
			if (this.activeId !== DEMO_ID || this.#ws) return;
			// Keep anything edited while the repository was being built.
			const changes: { path: string; source: string | null }[] = [];
			for (const [path, file] of this.vault.files)
				if (demoSources[path] !== file.source) changes.push({ path, source: file.source });
			for (const path of Object.keys(demoSources))
				if (!this.vault.file(path)) changes.push({ path, source: null });
			if (changes.length) await ws.save(changes);
			this.workspace = ws;
			this.layout = ws.record.layout;
			await this.refreshGit();
		} catch (e) {
			console.warn('Demo vault stays in memory:', e);
		}
	}

	/** Throw the demo away and start it fresh. */
	async resetDemo() {
		const demo = this.vaults.find((v) => v.id === DEMO_ID);
		if (demo) await this.removeVault(DEMO_ID, false);
		await this.openDemo();
	}

	async openVault(id: string) {
		if (id === DEMO_ID) return this.openDemo();
		const record = this.vaults.find((v) => v.id === id);
		if (!record) return;
		this.loadError = null;
		this.folderAccess = null;
		this.loading = { phase: 'Opening vault', ratio: null };
		try {
			if (record.kind === 'cloud') {
				const [{ CloudWorkspace }, { CLOUD_CONFIG }] = await Promise.all([
					import('$lib/sync/workspace'),
					import('./config'),
				]);
				const ws = CloudWorkspace.open($state.snapshot(record) as VaultRecord, CLOUD_CONFIG);
				await this.#activate(ws);
				return;
			}
			if (record.kind === 'folder') {
				const { FolderWorkspace } = await import('$lib/vault/folder');
				const ws = await FolderWorkspace.open($state.snapshot(record) as VaultRecord);
				if ((await ws.permission()) !== 'granted') {
					// Browsers only re-grant folder access from a click.
					this.folderAccess = { id, name: record.name };
					return;
				}
				await this.#activate(ws);
				return;
			}
			const { Workspace } = await import('$lib/git/workspace');
			await this.#activate(Workspace.open($state.snapshot(record) as VaultRecord));
		} catch (e) {
			this.loadError = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = null;
		}
	}

	/** Clone a repository as a new vault and switch to it. */
	async connect(input: ConnectInput): Promise<boolean> {
		this.loadError = null;
		this.connecting = { phase: 'Connecting', ratio: null };
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
				credentials:
					input.credentials ??
					(input.token ? { token: input.token, username: input.username || undefined } : null),
				layout: DEFAULT_LAYOUT,
				keywords: DEMO_KEYWORDS,
				log: {},
				createdAt: Date.now(),
				lastSync: Date.now(),
				dirty: [],
			};
			const ws = await Workspace.create(
				record,
				(p) => (this.connecting = { ...p, phase: `Cloning · ${p.phase}` }),
			);
			this.connecting = null;
			this.vaults = [...this.vaults.filter((v) => v.id !== ws.record.id), ws.record];
			await this.#activate(ws);
			return true;
		} catch (e) {
			this.loadError = describeGitError(e);
			return false;
		} finally {
			this.connecting = null;
			this.loading = null;
		}
	}

	/** Ask again for access to a folder vault (call from a click). */
	async grantFolder() {
		const pending = this.folderAccess;
		const record = pending && this.vaults.find((v) => v.id === pending.id);
		if (!record) return;
		const { FolderWorkspace } = await import('$lib/vault/folder');
		const ws = await FolderWorkspace.open($state.snapshot(record) as VaultRecord);
		if (!(await ws.requestAccess())) return;
		this.folderAccess = null;
		this.loading = { phase: 'Opening folder', ratio: null };
		try {
			await this.#activate(ws);
		} catch (e) {
			this.loadError = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = null;
		}
	}

	/** Pick a folder on this computer and open it as a vault. */
	async openFolder(): Promise<boolean> {
		const { FolderWorkspace, pickFolder } = await import('$lib/vault/folder');
		const handle = await pickFolder();
		if (!handle) return false;
		this.loadError = null;
		this.loading = { phase: 'Reading folder', ratio: null };
		try {
			const record: VaultRecord = {
				id: crypto.randomUUID(),
				name: handle.name,
				kind: 'folder',
				provider: 'other',
				url: null,
				branch: null,
				corsProxy: null,
				author: { name: '', email: '' },
				credentials: null,
				layout: DEFAULT_LAYOUT,
				keywords: DEMO_KEYWORDS,
				log: {},
				createdAt: Date.now(),
				lastSync: null,
			};
			const ws = await FolderWorkspace.create(record, handle);
			this.vaults = [...this.vaults, ws.record];
			await this.#activate(ws);
			return true;
		} catch (e) {
			this.loadError = e instanceof Error ? e.message : String(e);
			return false;
		} finally {
			this.loading = null;
		}
	}

	/** Pick up edits made to a folder vault outside the app (on returning to the tab). */
	async refreshFolder() {
		const ws = this.folder;
		if (!ws || (await ws.permission()) !== 'granted') return;
		await this.flush();
		const files = await ws.load();
		const seen = new Set(files.map((f) => f.path));
		const changes: { path: string; source: string | null }[] = files
			.filter((f) => this.vault.file(f.path)?.source !== f.source)
			.map((f) => ({ path: f.path, source: f.source }));
		for (const path of this.vault.files.keys())
			if (!seen.has(path)) changes.push({ path, source: null });
		if (changes.length) {
			this.vault.apply(changes);
			this.rev += 1;
		}
	}

	async #activate(
		ws: Workspace | FolderWorkspace | CloudWorkspace,
		options: { quiet?: boolean } = {},
	) {
		// Vaults saved with the public test proxy move to this site's own worker, so
		// their tokens no longer pass through a third party.
		if (ws.kind === 'git') {
			const { DEFAULT_GIT_PROXY, PUBLIC_TEST_PROXY } = await import('./config');
			const proxy = ws.record.corsProxy?.replace(/\/$/, '');
			if (proxy === PUBLIC_TEST_PROXY && DEFAULT_GIT_PROXY !== PUBLIC_TEST_PROXY) {
				await ws.updateRecord({ corsProxy: DEFAULT_GIT_PROXY });
				this.vaults = this.vaults.map((v) => (v.id === ws.record.id ? { ...ws.record } : v));
			}
		}
		const files = await ws.load((p) => {
			if (!options.quiet) this.loading = p;
		});
		this.#dropUrls();
		this.workspace = ws.kind === 'git' ? ws : null;
		this.folder = ws.kind === 'folder' ? ws : null;
		this.cloud = ws.kind === 'cloud' ? ws : null;
		this.cloudSync = {
			state: 'idle',
			pending: ws.kind === 'cloud' ? ws.pending.length : 0,
			lastSync: ws.record.lastSync,
		};
		this.activeId = ws.record.id;
		this.layout = ws.record.layout;
		this.vault = Vault.fromIndexed(files, ws.record.keywords);
		this.logSettings = { ...detectLogSettings(files.map((f) => f.source)), ...ws.record.log };
		this.#trees.clear();
		this.sync = { kind: 'idle' };
		writeLocal(ACTIVE_KEY, ws.record.id);
		this.rev += 1;
		await this.refreshGit();
		if (ws.kind === 'cloud') this.#queueCloudSync(0);
	}

	async updateVault(patch: Partial<VaultRecord>) {
		const ws = this.#ws;
		if (!ws) return;
		await ws.updateRecord(patch);
		this.vaults = this.vaults.map((v) => (v.id === ws.record.id ? { ...ws.record } : v));
		if (patch.keywords) await ws.clearCache();
		if (patch.layout || patch.keywords) await this.openVault(ws.record.id);
		if (patch.log) this.logSettings = { ...this.logSettings, ...patch.log };
	}

	/** Save, rename or delete named agenda views for the open vault. */
	async saveAgendaViews(views: SavedAgendaView[]) {
		await this.updateVault({ agendaViews: $state.snapshot(views) as SavedAgendaView[] });
	}

	/** Remove a vault's local copy. Uncommitted and unpushed work is lost; the remote is untouched. */
	async removeVault(id: string, reopen = true) {
		const record = this.vaults.find((v) => v.id === id);
		if (!record) return;
		if (record.kind === 'cloud') {
			const { CloudWorkspace } = await import('$lib/sync/workspace');
			const ws =
				this.cloud?.record.id === id
					? this.cloud
					: CloudWorkspace.open($state.snapshot(record) as VaultRecord, {});
			await ws.destroy();
			if (this.cloud?.record.id === id) this.cloud = null;
		} else if (record.kind === 'folder') {
			const { FolderWorkspace } = await import('$lib/vault/folder');
			const ws =
				this.folder?.record.id === id
					? this.folder
					: await FolderWorkspace.open($state.snapshot(record) as VaultRecord).catch(() => null);
			if (ws) await ws.destroy();
			else {
				const { db } = await import('$lib/store/db');
				await db().vaults.delete(id);
			}
			if (this.folder?.record.id === id) this.folder = null;
		} else {
			const { Workspace } = await import('$lib/git/workspace');
			const ws =
				this.workspace?.record.id === id
					? this.workspace
					: Workspace.open($state.snapshot(record) as VaultRecord);
			await ws.destroy();
		}
		if (this.folderAccess?.id === id) this.folderAccess = null;
		this.vaults = this.vaults.filter((v) => v.id !== id);
		if (this.activeId === id && reopen) await this.openDemo();
	}

	// ------------------------------------------------------------------ edits

	/**
	 * Apply a new file text: update the model now, autosave to the working
	 * tree in the background (and commit, if the vault auto-commits).
	 */
	#write(path: string, text: string | null, message: string, options: { inVault?: boolean } = {}) {
		// Files beside the notes (archives) are saved but not indexed as notes.
		const [file] = options.inVault === false ? [] : this.vault.apply([{ path, source: text }]);
		this.#edits += 1;
		this.rev += 1;
		const ws = this.#ws;
		if (!ws) {
			// The demo's repository is still being built: save once it exists.
			const ready = this.#demoReady;
			if (ready)
				this.#saving = this.#saving
					.then(() => ready)
					.then(async () => {
						await this.workspace?.save([{ path, source: text, ...(file ? { file } : {}) }]);
						this.#scheduleStatus();
					})
					.catch(() => undefined);
			return;
		}
		this.#saving = this.#saving
			.then(async () => {
				await ws.save([{ path, source: text, ...(file ? { file } : {}) }]);
				if (ws.kind === 'git' && ws.record.autoCommit) await ws.commit([path], message);
				if (ws.kind === 'cloud') {
					this.#cloudQuiet = 0;
					this.cloudSync = { ...this.cloudSync, pending: ws.pending.length };
					this.#queueCloudSync(CLOUD_EDIT_DELAY);
				}
				this.#scheduleStatus();
			})
			.catch((e) => {
				this.sync = { kind: 'error', message: `Could not save ${path}: ${describeGitError(e)}` };
			});
	}

	#edit(path: string, changes: (source: string) => Change[], message: string) {
		const file = this.vault.file(path);
		if (!file) return;
		const next = applyChanges(file.source, changes(file.source));
		if (next !== file.source) this.#write(path, next, message);
	}

	// ------------------------------------------------------------------ links

	/**
	 * Where a link to a vault file goes, with an optional org search option
	 * (`*Heading`, `#custom-id`, `target`). A search that lands exactly on a
	 * heading that is itself a node opens that node; otherwise the page that
	 * holds the target opens and scrolls to it. `null` if the file isn't here.
	 */
	linkTarget(path: string, search: string | null): { href: string; title: string } | null {
		const file = this.vault.file(path);
		if (!file) return null;
		const nodes = file.index.nodes;
		const fileNode = nodes.find((n) => n.level === 0);
		const fallback = fileNode ?? null;
		if (!search) {
			return fallback
				? { href: href.node(fallback.id), title: fallback.title }
				: { href: href.file(path), title: file.index.title || path };
		}
		const at = findSearchTarget(file.source, parseSearchOption(search), file.index.keywords);
		const label = search.replace(/^[*#]/, '');
		if (at === null)
			return fallback
				? { href: href.node(fallback.id, search), title: label }
				: { href: href.file(path, search), title: label };
		// The deepest heading node whose subtree holds the target.
		const lines = splitLines(file.source);
		let owner = fallback;
		for (const n of nodes) {
			if (n.level === 0 || n.pos > at) continue;
			const h = headlineAt(file.source, n.pos, file.index.keywords, lines);
			if (h && subtreeEnd(lines, h) > at && (!owner || owner.level < n.level)) owner = n;
		}
		if (owner && owner.level > 0 && owner.pos === at)
			return { href: href.node(owner.id), title: owner.title };
		return owner
			? { href: href.node(owner.id, search), title: label }
			: { href: href.file(path, search), title: label };
	}

	// ------------------------------------------------------------------ files

	#urls = new Map<string, Promise<string | null>>();

	/** A text file from the vault's storage (notes first, then any file), or `null`. */
	async readText(path: string): Promise<string | null> {
		const note = this.vault.file(path);
		if (note) return note.source;
		const ws = this.#ws;
		return ws ? ws.readText(path).catch(() => null) : null;
	}

	/**
	 * A displayable URL for a vault file (an image or attachment), or `null`
	 * if it isn't there (or, for a cloud vault, can't be fetched right now).
	 */
	fileUrl(path: string): Promise<string | null> {
		const key = `${this.activeId}\u0000${path}`;
		let hit = this.#urls.get(key);
		if (!hit) {
			const ws = this.#ws;
			hit = (async () => {
				const bytes = ws ? await ws.readBytes(path).catch(() => null) : null;
				if (!bytes) {
					this.#urls.delete(key);
					return null;
				}
				const { mediaType } = await import('$lib/vault/files');
				return URL.createObjectURL(
					new Blob([bytes as unknown as BlobPart], { type: mediaType(path) }),
				);
			})();
			this.#urls.set(key, hit);
		}
		return hit;
	}

	/** Forget cached file URLs (another vault opened, or a file replaced). */
	#dropUrls(path?: string) {
		for (const [key, url] of this.#urls) {
			if (path && !key.endsWith(`\u0000${path}`)) continue;
			void url.then((u) => u && URL.revokeObjectURL(u));
			this.#urls.delete(key);
		}
	}

	/** Resolves once every pending autosave has been written. */
	flush(): Promise<void> {
		return this.#saving;
	}

	/** Replace a file's text (the source editor; it sends only what changed). */
	setSource(path: string, text: string) {
		const file = this.vault.file(path);
		if (!file || file.source === text) return;
		this.#write(path, text, `Edit ${this.#title(path)}`);
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

	/**
	 * Create a new node file the way org-roam's default template does:
	 * `%<%Y%m%d%H%M%S>-${slug}.org` with an `:ID:` drawer and `#+title:`.
	 * Returns its id (an existing node with that title is reused).
	 */
	createNode(title: string, tags: string[] = []): string | null {
		const clean = title.replace(/\s+/g, ' ').trim();
		if (!clean) return null;
		const existing = this.vault.titles.get(clean.toLowerCase());
		if (existing) return existing;
		const id = crypto.randomUUID();
		const path = nodePath(this.layout, roamFileName(slugify(clean) || 'note', new Date()));
		this.#write(path, newNodeSource(clean, id, { filetags: tags }), `Create ${clean}`);
		return id;
	}

	/** This vault's capture templates (Mycelium's defaults until it has its own). */
	get captureTemplates(): CaptureTemplate[] {
		return this.activeVault?.captureTemplates ?? DEFAULT_CAPTURE_TEMPLATES;
	}

	async saveCaptureTemplates(templates: CaptureTemplate[] | null) {
		await this.updateVault({
			captureTemplates: templates ? ($state.snapshot(templates) as CaptureTemplate[]) : undefined,
		});
	}

	/** This vault's settings (and this browser's appearance) as a settings file. */
	async settingsFile(): Promise<string> {
		const { exportSettings, serializeSettings } = await import('./settings-file');
		const record = this.activeVault;
		return serializeSettings(
			exportSettings({
				theme: this.theme,
				textSize: this.textSize,
				keywords: this.vault.keywords,
				keywordTones: record?.keywordTones,
				log: record?.log,
				autoCommit: record?.autoCommit,
				captureTemplates: $state.snapshot(this.captureTemplates) as CaptureTemplate[],
				agendaViews: record?.agendaViews,
				layout: this.layout,
			}),
		);
	}

	/** Apply the chosen sections of an imported settings file to this vault. */
	async importSettings(
		file: import('./settings-file').SettingsFile,
		sections: Set<import('./settings-file').SettingsSection>,
	) {
		const { workflowKeywords } = await import('./settings-file');
		// Plain data: IndexedDB can't store reactive proxies.
		file = $state.snapshot(file) as typeof file;
		if (sections.has('appearance') && file.appearance) {
			if (file.appearance.theme) this.setTheme(file.appearance.theme);
			if (file.appearance.textSize) this.setTextSize(file.appearance.textSize);
		}
		const patch: Partial<VaultRecord> = {};
		if (sections.has('workflow') && file.workflow) {
			patch.keywords = workflowKeywords(file)!;
			if (file.workflow.tones) patch.keywordTones = file.workflow.tones;
			if (file.workflow.log) patch.log = file.workflow.log;
			if (file.workflow.autoCommit !== undefined) patch.autoCommit = file.workflow.autoCommit;
		}
		if (sections.has('capture') && file.capture) patch.captureTemplates = file.capture.templates;
		if (sections.has('agenda') && file.agenda) patch.agendaViews = file.agenda.views;
		if (sections.has('layout') && file.layout) patch.layout = file.layout;
		if (Object.keys(patch).length) await this.updateVault(patch);
	}

	/** Quick capture with the first template (the home page's box). */
	capture(text: string): CaptureResult | null {
		const template = this.captureTemplates[0];
		return template ? this.captureWith(template, { text }) : null;
	}

	/**
	 * Capture with a template: expand it, then add it to today's daily note, a
	 * file under a heading (created if missing), or a new note.
	 */
	captureWith(
		template: CaptureTemplate,
		input: { text: string; values?: Record<string, string>; title?: string; link?: string },
	): CaptureResult | null {
		const now = localNow();
		const ctx = { now, text: input.text.trim(), values: input.values, link: input.link };
		const target = template.target;
		if (target.kind === 'node') {
			const body = shapeCapture(expandTemplate(template.template, ctx), template.type);
			const title = (input.title ?? '').replace(/\s+/g, ' ').trim() || body.split('\n')[0]!.trim();
			if (!title) return null;
			const id = crypto.randomUUID();
			const path = nodePath(this.layout, roamFileName(slugify(title) || 'note', new Date()));
			const text = newNodeSource(title, id) + (body.trim() ? `\n${body}\n` : '');
			this.#write(path, text, `Capture ${template.name}: ${title}`);
			return { path, id, label: title };
		}
		let path: string;
		if (target.kind === 'daily') {
			this.ensureDaily(now.date);
			path = this.dailyPath(now.date);
		} else {
			path = nodePath(this.layout, target.path.replace(/^\/+/, ''));
			if (!this.vault.file(path)) {
				const name = path
					.split('/')
					.pop()!
					.replace(/\.org$/i, '');
				this.#write(path, `#+title: ${name}\n`, `Create ${path}`);
			}
		}
		const file = this.vault.file(path);
		if (!file) return null;
		const next = applyChanges(
			file.source,
			applyTemplate(file.source, template, ctx, target.heading),
		);
		if (next === file.source) return null;
		const label = target.kind === 'daily' ? "today's note" : (file.index.title ?? path);
		this.#write(path, next, `Capture ${template.name} to ${label}`);
		return { path, id: this.vault.fileNode(path)?.id ?? null, label };
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
		// org-provide-todo-statistics: recount the parent's [n/m] / [%] cookie.
		const parent = parentHeading(result.text, offset, file.index.keywords);
		if (parent !== null)
			result.text = applyChanges(
				result.text,
				updateTodoCookies(result.text, parent, file.index.keywords),
			);
		// org-clock-out-when-done: finishing a clocked task stops its clock (a
		// repeating task too: the hook sees the done state before it repeats).
		const target = keyword ?? '';
		if (file.index.keywords.doneKeywords.includes(target))
			result.text = applyChanges(
				result.text,
				clockOut(result.text, offset, localNow(), file.index.keywords),
			);
		this.#write(
			path,
			result.text,
			`${result.repeated ? 'Repeat' : (result.keyword ?? 'Clear state')}: ${heading}`,
		);
	}

	/** Turn an unlinked mention into a link to the node: `[[id:ID][mention]]`. */
	linkMention(path: string, offset: number, text: string, id: string) {
		const file = this.vault.file(path);
		if (!file || file.source.slice(offset, offset + text.length) !== text) return;
		this.#write(
			path,
			applyChanges(file.source, [
				{ from: offset, to: offset + text.length, insert: `[[id:${id}][${text}]]` },
			]),
			`Link ${text}`,
		);
	}

	// ------------------------------------------------------------------ refile and archive

	/**
	 * The maths sheet: the formula being written (or edited), and what to do
	 * with it. The editor opens it and puts the result where the cursor was.
	 */
	mathSheet = $state<{
		tex: string;
		display: boolean;
		editing: boolean;
		apply: (tex: string, display: boolean) => void;
	} | null>(null);

	// ------------------------------------------------------------------ pictures

	/** The folder pictures added from the app go into. */
	get imageDir(): string {
		return this.activeVault?.imageDir ?? 'images';
	}

	/** The picture sheet: a chosen file, and where its link goes once saved. */
	imageSheet = $state<{
		file: File;
		note: string;
		insert: (link: string, caption: string) => void;
	} | null>(null);

	/**
	 * Save a picture into the vault's images folder and return its org link
	 * from `note`. Git vaults list it with the other changes; cloud vaults
	 * upload it straight away; folder vaults write it to disk.
	 */
	async saveImage(note: string, name: string, bytes: Uint8Array, ext: string): Promise<string> {
		const { imagePath, imageLink } = await import('$lib/vault/images');
		const path = imagePath(this.imageDir, name, ext, new Date());
		if (this.#demoReady) await this.#demoReady;
		const ws = this.#ws;
		if (!ws) throw new Error('This vault can’t store pictures here.');
		await ws.writeBytes(path, bytes);
		this.rev += 1;
		this.#scheduleStatus();
		return imageLink(note, path);
	}

	// ------------------------------------------------------------------ tables

	/** The table editor sheet: the table at `offset` in `path`. */
	tableSheet = $state<{ path: string; offset: number; done?: () => void } | null>(null);

	/**
	 * Write a table back, aligned as org-table-align does. `before` is the
	 * table's text when editing began: if it has changed since (a sync, or
	 * Emacs), nothing is written and this returns false.
	 */
	replaceTable(path: string, offset: number, before: string, rows: TableRow[]): boolean {
		const file = this.vault.file(path);
		const t = file && tableAt(file.source, offset);
		if (!file || !t || file.source.slice(t.from, t.to) !== before) return false;
		const text = formatTable(rows, t.indent);
		if (text !== before)
			this.#write(
				path,
				applyChanges(file.source, [{ from: t.from, to: t.to, insert: text }]),
				`Edit table in ${this.#title(path)}`,
			);
		return true;
	}

	/** Open the refile picker for a heading. */
	refileSheet = $state<{ path: string; pos: number } | null>(null);

	/**
	 * Move a subtree (org-refile): the last child of `target.pos`, or a
	 * top-level tree at the end of `target.path` when `pos` is null.
	 */
	refile(path: string, pos: number, target: { path: string; pos: number | null }): boolean {
		const from = this.vault.file(path);
		const to = this.vault.file(target.path);
		if (!from || !to) return false;
		const title = headlineAt(from.source, pos, from.index.keywords)?.title.value ?? 'heading';
		const where =
			target.pos === null
				? to.index.title || target.path
				: (headlineAt(to.source, target.pos, to.index.keywords)?.title.value ?? '');
		const message = `Refile ${title} → ${where}`;
		if (path === target.path) {
			const changes = refileWithin(from.source, pos, target.pos, from.index.keywords);
			if (!changes) return false;
			this.#write(path, applyChanges(from.source, changes), message);
			return true;
		}
		const r = refileAcross(
			from.source,
			pos,
			to.source,
			target.pos,
			from.index.keywords,
			to.index.keywords,
		);
		if (!r) return false;
		this.#write(target.path, applyChanges(to.source, r.target), message);
		this.#write(path, applyChanges(from.source, r.source), message);
		return true;
	}

	/**
	 * Archive a subtree (org-archive-subtree) to its archive location: by
	 * default `<file>_archive` beside the file. Returns where it went, or an
	 * error message.
	 */
	async archive(path: string, pos: number): Promise<{ to: string } | { error: string }> {
		const file = this.vault.file(path);
		const ws = this.#ws;
		if (!file) return { error: 'File not found' };
		if (!ws) return { error: "The demo's storage isn't ready yet; try again in a moment." };
		const kw = file.index.keywords;
		const entry = file.index.headlines.find((h) => h.pos === pos);
		const h = headlineAt(file.source, pos, kw);
		const own = h?.tags?.values ?? [];
		const location = archiveLocation(file.source, pos, path, kw);
		await this.flush();
		const existing = location.file
			? (this.vault.file(location.file)?.source ??
				(await ws.readText(location.file).catch(() => null)))
			: null;
		const r = archiveSubtree(
			file.source,
			pos,
			path,
			{
				now: localNow(),
				file: path,
				category:
					entry?.category ??
					path
						.split('/')
						.pop()!
						.replace(/\.org$/i, ''),
				inheritedTags: (entry?.tags ?? []).filter((t) => !own.includes(t)),
			},
			existing,
			kw,
		);
		if (!r) return { error: 'Nothing to archive here' };
		const message = `Archive ${h?.title.value ?? 'heading'}`;
		if (r.archivePath && r.archiveText !== null)
			this.#write(r.archivePath, r.archiveText, message, {
				inVault: /\.org$/i.test(r.archivePath),
			});
		this.#write(path, applyChanges(file.source, r.source), message);
		return { to: r.archivePath ?? path };
	}

	// ------------------------------------------------------------------ clock

	/** Running clocks across the vault (normally one), newest first. */
	get runningClocks() {
		void this.rev;
		const out: {
			path: string;
			heading: number;
			title: string;
			start: { date: string; time: string };
		}[] = [];
		for (const file of this.vault.files.values())
			for (const c of runningClocks(file.source, file.index.keywords))
				out.push({ path: file.path, heading: c.heading, title: c.title, start: c.start });
		return out.sort((a, b) => clockMillis(b.start) - clockMillis(a.start));
	}

	/**
	 * Clock in on a heading. Like `org-clock-in`, a clock running elsewhere is
	 * clocked out first, at the same minute; one already running here goes on.
	 */
	clockIn(path: string, heading: number) {
		const now = localNow();
		for (const c of this.runningClocks) {
			if (c.path === path && c.heading === heading) return;
			const before = this.vault.file(c.path)?.source.length ?? 0;
			this.#edit(
				c.path,
				(src) => clockOut(src, c.heading, now, this.#keywords(c.path)),
				`Clock out: ${c.title}`,
			);
			// Closing a clock earlier in the same file moves this heading down.
			if (c.path === path && c.heading < heading)
				heading += (this.vault.file(path)?.source.length ?? before) - before;
		}
		const file = this.vault.file(path);
		if (!file) return;
		this.#edit(
			path,
			(src) =>
				clockIn(src, heading, now, {
					logDrawer: this.logSettings.logIntoDrawer,
					config: file.index.keywords,
				}),
			`Clock in: ${headlineAt(file.source, heading, file.index.keywords)?.title.value ?? this.#title(path)}`,
		);
	}

	clockOut(path: string, heading: number) {
		const minutes = this.#clockMinutes(path, heading);
		this.#undoable(
			path,
			minutes === null ? 'Clock stopped' : `Clock stopped · ${formatDuration(minutes)}`,
			() =>
				this.#edit(
					path,
					(src) => clockOut(src, heading, localNow(), this.#keywords(path)),
					'Clock out',
				),
		);
	}

	clockCancel(path: string, heading: number) {
		this.#undoable(path, 'Clock cancelled', () =>
			this.#edit(path, (src) => clockCancel(src, heading, this.#keywords(path)), 'Cancel clock'),
		);
	}

	/** The last clock stop or cancel, which can be undone for a few seconds. */
	clockUndo = $state<{ path: string; before: string; after: string; text: string } | null>(null);

	#undoable(path: string, text: string, run: () => void) {
		const before = this.vault.file(path)?.source;
		run();
		const after = this.vault.file(path)?.source;
		if (before !== undefined && after !== undefined && after !== before)
			this.clockUndo = { path, before, after, text };
	}

	/** Put back the clock that was just stopped or cancelled (if the file hasn't changed since). */
	undoClock() {
		const u = this.clockUndo;
		this.clockUndo = null;
		if (u && this.vault.file(u.path)?.source === u.after)
			this.#write(u.path, u.before, 'Undo clock change');
	}

	#clockMinutes(path: string, heading: number): number | null {
		const c = this.runningClocks.find((r) => r.path === path && r.heading === heading);
		return c ? Math.max(0, Math.floor((Date.now() - clockMillis(c.start)) / 60_000)) : null;
	}

	/** Minutes clocked in a heading's subtree, and its Effort, for display. */
	clockSummary(path: string, heading: number): { minutes: number; effort: number | null } {
		void this.rev;
		const file = this.vault.file(path);
		if (!file) return { minutes: 0, effort: null };
		const minutes = subtreeClockSum(file.source, heading, file.index.keywords);
		const effort = file.index.headlines.find((h) => h.pos === heading)?.effort ?? null;
		return { minutes, effort };
	}

	#keywords(path: string) {
		return this.vault.file(path)?.index.keywords ?? this.vault.keywords;
	}

	/** A heading's current state, read from its file (for the heading sheet). */
	heading(path: string, pos: number) {
		void this.rev;
		const file = this.vault.file(path);
		if (!file) return null;
		const kw = file.index.keywords;
		const h = headlineAt(file.source, pos, kw);
		if (!h || h.line.from !== pos) return null;
		const planning = getPlanning(file.source, pos, kw);
		const entry = file.index.headlines.find((e) => e.pos === pos);
		return {
			level: h.level,
			todo: h.keyword?.value ?? null,
			priority: h.priority?.value ?? null,
			title: h.title.value,
			tags: h.tags?.values ?? [],
			scheduled: planning.SCHEDULED,
			deadline: planning.DEADLINE,
			id: getProperty(file.source, pos, 'ID', kw),
			ownerId: entry?.ownerId ?? null,
			keywords: kw,
		};
	}

	setTitle(path: string, offset: number, title: string) {
		const kw = this.vault.file(path)?.index.keywords;
		this.#edit(
			path,
			(s) => setHeadlineTitle(s, offset, title, kw),
			`Retitle heading in ${this.#title(path)}`,
		);
	}

	/** Open the note that owns a heading in the editor, with the cursor on it. */
	editHeading(path: string, pos: number): string | null {
		const owner = this.vault.file(path)?.index.headlines.find((h) => h.pos === pos)?.ownerId;
		if (!owner) return null;
		this.editAt = pos;
		this.editing = true;
		return owner;
	}

	setPriority(path: string, offset: number, priority: string | null) {
		const kw = this.vault.file(path)?.index.keywords;
		this.#edit(
			path,
			(s) => setPriority(s, offset, priority, kw),
			`Set priority in ${this.#title(path)}`,
		);
	}

	setTags(path: string, offset: number, tags: string[]) {
		const kw = this.vault.file(path)?.index.keywords;
		this.#edit(path, (s) => setHeadlineTags(s, offset, tags, kw), `Tag ${this.#title(path)}`);
	}

	/** Set or clear a SCHEDULED/DEADLINE date (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`), keeping repeaters. */
	setPlanningDate(path: string, offset: number, kind: PlanningKind, input: string | null) {
		const kw = this.vault.file(path)?.index.keywords;
		this.#edit(
			path,
			(s) => {
				if (!input) return setPlanning(s, offset, kind, null, kw);
				const base = getPlanning(s, offset, kw)[kind];
				const ts = parseTimestampInput(input, base, { active: kind !== 'CLOSED' });
				return ts ? setPlanning(s, offset, kind, ts, kw) : [];
			},
			`${input ? 'Set' : 'Clear'} ${kind.toLowerCase()} in ${this.#title(path)}`,
		);
	}

	/** Give a heading an `:ID:` so org-roam treats it as a node. Returns the id. */
	makeNode(path: string, offset: number): string | null {
		const file = this.vault.file(path);
		if (!file) return null;
		const existing = getProperty(file.source, offset, 'ID', file.index.keywords);
		if (existing) return existing;
		const id = crypto.randomUUID();
		this.#edit(
			path,
			(s) => setProperty(s, offset, 'ID', id, file.index.keywords),
			`Make a node in ${this.#title(path)}`,
		);
		return id;
	}

	/** Give a whole file an `:ID:` (a drawer at the top, as org-roam writes it), making it a note. */
	makeFileNode(path: string): string | null {
		const file = this.vault.file(path);
		if (!file) return null;
		const existing = getProperty(file.source, null, 'ID', file.index.keywords);
		if (existing) return existing;
		const id = crypto.randomUUID();
		this.#edit(
			path,
			(s) => setProperty(s, null, 'ID', id, file.index.keywords),
			`Make ${this.#title(path)} a note`,
		);
		return id;
	}

	#title(path: string) {
		return this.vault.file(path)?.index.title ?? path;
	}

	// ------------------------------------------------------------------ git

	#scheduleStatus() {
		if (this.#statusTimer) clearTimeout(this.#statusTimer);
		this.#statusTimer = setTimeout(() => void this.refreshGit(), 250);
	}

	/** Re-read branch, uncommitted changes and ahead/behind (no network). */
	async refreshGit() {
		const ws = this.workspace;
		if (!ws) {
			this.git = { branch: '', changes: [], ahead: 0, behind: 0, hasRemote: false };
			return;
		}
		const [changes, counts, branch] = await Promise.all([
			ws.status(),
			ws.aheadBehind(),
			ws.repo.branch(),
		]);
		this.git = { branch, changes, ...counts, hasRemote: ws.repo.hasRemote() };
	}

	async commit(paths: string[], message: string): Promise<boolean> {
		const ws = this.workspace;
		if (!ws || !message.trim() || paths.length === 0) return false;
		await this.flush();
		await ws.commit(paths, message.trim());
		await this.refreshGit();
		this.sync = {
			kind: 'done',
			message: `Committed ${paths.length} ${paths.length === 1 ? 'file' : 'files'}`,
		};
		return true;
	}

	async discard(path: string) {
		const ws = this.workspace;
		if (!ws) return;
		await this.flush();
		const text = await ws.discard(path);
		const [file] = this.vault.apply([{ path, source: text }]);
		await ws.cache([{ path, source: text, ...(file ? { file } : {}) }]);
		this.rev += 1;
		await this.refreshGit();
	}

	async #run<T>(phase: string, task: (ws: Workspace) => Promise<T>): Promise<T | undefined> {
		const ws = this.workspace;
		if (!ws || this.sync.kind === 'busy') return undefined;
		this.sync = { kind: 'busy', phase };
		try {
			await this.flush();
			await this.#freshCredentials(ws);
			return await task(ws);
		} catch (e) {
			const readOnly =
				!ws.record.credentials && (e as { code?: string }).code === 'UserCanceledError';
			this.sync = {
				kind: 'error',
				message: readOnly
					? 'This vault is read-only: your commits stay here. Add an access token in Settings to push them.'
					: describeGitError(e),
			};
			return undefined;
		} finally {
			if (this.sync.kind === 'busy') this.sync = { kind: 'idle' };
			await this.refreshGit().catch(() => undefined);
			this.vaults = this.vaults.map((v) => (v.id === ws.record.id ? { ...ws.record } : v));
		}
	}

	/** Renew a signed-in vault's access token shortly before it expires. */
	async #freshCredentials(ws: Workspace) {
		const creds = ws.record.credentials;
		const provider = ws.record.provider;
		const { needsRefresh, refreshCredentials } = await import('$lib/auth/oauth');
		if (provider === 'other' || !needsRefresh(creds)) return;
		const { OAUTH_CONFIG, OAUTH_REDIRECT } = await import('./config');
		try {
			const next = await refreshCredentials(provider, creds!, OAUTH_CONFIG, OAUTH_REDIRECT());
			await ws.updateRecord({ credentials: next });
		} catch {
			throw new Error('Your sign-in has expired. Sign in again from Vaults to keep syncing.');
		}
	}

	/** Fetch, then fast-forward or merge. Conflicts open the resolver; uncommitted files are never overwritten. */
	async pull(resolutions?: Map<string, string>) {
		if (this.cloud) return this.syncCloud({ resolutions });
		await this.#run('Pulling', async (ws) => {
			const result = await ws.pull(
				resolutions,
				(p) => (this.sync = { kind: 'busy', phase: p.phase }),
			);
			switch (result.status) {
				case 'conflict':
					this.sync = { kind: 'conflict', conflicts: result.conflicts };
					return;
				case 'blocked':
					this.sync = {
						kind: 'error',
						message: `The remote changed ${result.paths.join(', ')}, which you've edited but not committed. Commit (or discard) those first, then pull.`,
					};
					return;
				case 'unsupported-conflict':
					this.sync = {
						kind: 'error',
						message: `A file was deleted on one side and edited on the other: ${result.paths.join(', ')}. Resolve it with another git client.`,
					};
					return;
				case 'no-remote':
					this.sync = { kind: 'done', message: 'This vault has no remote' };
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
					const n = result.changes.length;
					this.sync = {
						kind: 'done',
						message:
							result.status === 'merged'
								? `Merged ${n} ${n === 1 ? 'file' : 'files'} — push when ready`
								: `Pulled ${n} ${n === 1 ? 'file' : 'files'}`,
					};
					return;
				}
				default:
					this.sync = { kind: 'done', message: 'Already up to date' };
			}
		});
	}

	async push() {
		await this.#run('Pushing', async (ws) => {
			const result = await ws.push((p) => (this.sync = { kind: 'busy', phase: p.phase }));
			this.sync = {
				kind: 'done',
				message:
					result.status === 'pushed'
						? `Pushed ${result.commits} ${result.commits === 1 ? 'commit' : 'commits'}`
						: result.status === 'no-remote'
							? 'This vault has no remote'
							: 'Nothing to push',
			};
		});
	}

	async fetchRemote() {
		await this.#run('Fetching', async (ws) => {
			const { behind } = await ws.fetch();
			this.sync = {
				kind: 'done',
				message: behind
					? `${behind} new ${behind === 1 ? 'commit' : 'commits'} to pull`
					: 'Already up to date',
			};
		});
	}

	async switchBranch(name: string) {
		const ws = this.workspace;
		if (!ws) return;
		await this.#run(`Switching to ${name}`, async () => {
			await ws.switchBranch(name);
			await ws.clearCache();
			await this.#activate(ws);
			this.sync = { kind: 'done', message: `On ${name}` };
		});
	}

	async createBranch(name: string) {
		await this.#run(`Creating ${name}`, async (ws) => {
			await ws.createBranch(name);
			this.sync = { kind: 'done', message: `Created and switched to ${name}` };
		});
	}

	// ------------------------------------------------------------------ cloud

	/** Sync the cloud vault soon (edits are batched; `0`: now). */
	#queueCloudSync(delay: number) {
		if (this.#cloudTimer) clearTimeout(this.#cloudTimer);
		this.#cloudTimer = setTimeout(() => {
			this.#cloudTimer = null;
			void this.syncCloud({ auto: true });
		}, delay);
	}

	#cloudRun: Promise<void> | null = null;
	/** Checks in a row that found nothing new (or failed): the pace slows while quiet. */
	#cloudQuiet = 0;
	/** When the last check started (successful or not). */
	#cloudLastCheck = 0;
	#shownConflicts = '';

	/**
	 * Exchange changes with the cloud service. Automatic runs stay quiet (a status in the
	 * sidebar); conflicts open the resolver, whose choices come back as
	 * `resolutions`.
	 */
	async syncCloud(options: CloudSyncOptions = {}): Promise<void> {
		const ws = this.cloud;
		if (!ws) return;
		if (this.#cloudRun) {
			// One at a time; an edit or a click during a sync runs another after it.
			if (!options.auto || ws.pending.length) {
				await this.#cloudRun;
				return this.syncCloud(options);
			}
			return this.#cloudRun;
		}
		// An automatic sync never reopens a conflict someone is looking at.
		if (options.auto && this.sync.kind === 'conflict') return;
		if (options.auto && typeof navigator !== 'undefined' && navigator.onLine === false) {
			this.cloudSync = { ...this.cloudSync, state: 'offline' };
			return;
		}
		this.#cloudRun = this.#syncCloud(ws, options).finally(() => (this.#cloudRun = null));
		return this.#cloudRun;
	}

	async #syncCloud(ws: CloudWorkspace, options: CloudSyncOptions) {
		this.cloudSync = { ...this.cloudSync, state: 'syncing' };
		this.#cloudLastCheck = Date.now();
		const name = ws.service.name;
		if (!options.auto) this.sync = { kind: 'busy', phase: `Syncing with ${name}` };
		// What's on screen now, to merge with anything typed while the sync runs.
		const before = new Map([...this.vault.files].map(([p, f]) => [p, f.source]));
		const edits = this.#edits;
		try {
			await this.flush();
			const outcome = await ws.sync(options.resolutions, (p) => {
				if (!options.auto) this.sync = { kind: 'busy', phase: p.phase };
			});
			if (this.cloud !== ws) return;
			await this.flush();
			await this.#applyCloud(ws, outcome.changes, before, edits !== this.#edits);
			const busy = outcome.pulled + outcome.pushed + outcome.changes.length > 0;
			this.#cloudQuiet = busy || !options.auto ? 0 : this.#cloudQuiet + 1;
			this.cloudSync = {
				state: 'idle',
				pending: ws.pending.length,
				lastSync: ws.record.lastSync,
			};
			this.vaults = this.vaults.map((v) => (v.id === ws.record.id ? { ...ws.record } : v));
			this.cloudSync.conflicts = outcome.conflicts.length;
			if (outcome.conflicts.length) {
				// Automatic syncs don't reopen conflicts someone chose to decide later.
				const key = outcome.conflicts
					.map((c) => c.path)
					.sort()
					.join('\n');
				if (!options.auto || key !== this.#shownConflicts) {
					this.#shownConflicts = key;
					this.sync = { kind: 'conflict', conflicts: outcome.conflicts };
				}
				return;
			}
			this.#shownConflicts = '';
			if (!options.auto) {
				const parts = [
					outcome.pulled && `${outcome.pulled} in`,
					outcome.pushed && `${outcome.pushed} out`,
				].filter(Boolean);
				this.sync = {
					kind: 'done',
					message: parts.length ? `Synced (${parts.join(', ')})` : `Up to date with ${name}`,
				};
			} else if (this.sync.kind === 'error' && this.sync.message.startsWith(`${name}:`))
				this.sync = { kind: 'idle' };
		} catch (e) {
			// Unreachable or failing: back off like a quiet spell.
			this.#cloudQuiet += 1;
			const offline =
				typeof navigator !== 'undefined' && navigator.onLine === false
					? true
					: e instanceof TypeError || (e as Error)?.name === 'TimeoutError';
			this.cloudSync = {
				...this.cloudSync,
				state: offline ? 'offline' : 'error',
				pending: ws.pending.length,
				message: offline ? 'Offline: edits upload when you reconnect' : describeCloudError(e, name),
			};
			// Being offline is normal on a phone; only a real failure (or a click) says so loudly.
			if (!options.auto || !offline)
				this.sync = {
					kind: 'error',
					message: offline
						? `${name}: couldn’t reach ${name}. Your edits are kept here and upload when you’re back online.`
						: `${name}: ${describeCloudError(e, name)}`,
				};
		} finally {
			if (this.sync.kind === 'busy') this.sync = { kind: 'idle' };
			// Edits made while syncing go up next.
			if (this.cloud === ws && ws.pending.length && this.cloudSync.state === 'idle')
				this.#queueCloudSync(CLOUD_EDIT_DELAY);
		}
	}

	/** Bring synced files into the open vault, merging with anything typed meanwhile. */
	async #applyCloud(
		ws: CloudWorkspace,
		changes: { path: string; source: string | null }[],
		before: Map<string, string>,
		edited: boolean,
	) {
		const latest = new Map<string, string | null>();
		for (const c of changes) latest.set(c.path, c.source);
		const apply: { path: string; source: string | null }[] = [];
		for (const [path, source] of latest) {
			const now = this.vault.file(path)?.source ?? null;
			const then = before.get(path) ?? null;
			if (!edited || now === then) {
				if (now !== source) apply.push({ path, source });
				continue;
			}
			// Typed into while syncing: keep both, or keep the typing and merge again next time.
			if (now === null || source === null || now === source) continue;
			const { mergeText } = await import('$lib/git/merge');
			const merged = mergeText(then ?? '', now, source);
			if (merged.clean) this.#write(path, merged.text, 'Sync');
			else void ws.rebase(path, then ?? '');
		}
		if (apply.length) {
			this.vault.apply(apply);
			this.rev += 1;
		}
	}

	/** Watch for moments to sync: coming back to the app, reconnecting, and every minute. */
	#watchCloud() {
		if (typeof window === 'undefined') return;
		const visible = () => document.visibilityState === 'visible';
		// Coming back to the app (or back online): check now, at the quick pace again,
		// unless a check ran moments ago (desktop focus changes are frequent).
		const back = () => {
			if (!this.cloud || !visible() || Date.now() - this.#cloudLastCheck < 30_000) return;
			this.#cloudQuiet = 0;
			void this.syncCloud({ auto: true });
		};
		document.addEventListener('visibilitychange', back);
		window.addEventListener('online', back);
		window.addEventListener('focus', back);
		// Checks while open slow down when nothing changes; see nextCheckDelay.
		setInterval(() => {
			const ws = this.cloud;
			if (!ws || !visible()) return;
			const wait = nextCheckDelay({
				base: ws.basePoll,
				quiet: this.#cloudQuiet,
				saveData: saveDataOn(),
			});
			if (Date.now() - this.#cloudLastCheck >= wait) void this.syncCloud({ auto: true });
		}, 15_000);
		// Leaving the app: upload what's waiting.
		window.addEventListener('pagehide', () => {
			if (this.cloud?.pending.length) void this.syncCloud({ auto: true });
		});
	}

	/** Make a vault from a cloud folder (after signing in or entering a password) and open it. */
	async connectCloud(
		cloud: Omit<CloudState, 'cursor' | 'pending'>,
		name?: string,
	): Promise<boolean> {
		this.loadError = null;
		const [{ CloudWorkspace }, { SERVICES }, { CLOUD_CONFIG }] = await Promise.all([
			import('$lib/sync/workspace'),
			import('$lib/sync/services'),
			import('./config'),
		]);
		const service = SERVICES[cloud.service].name;
		this.connecting = { phase: `Connecting to ${service}`, ratio: null };
		try {
			const record: VaultRecord & { cloud: CloudState } = {
				id: crypto.randomUUID(),
				name: name ?? (cloud.root.split('/').filter(Boolean).pop() || service),
				kind: 'cloud',
				provider: 'other',
				url: null,
				branch: null,
				corsProxy: null,
				author: { name: '', email: '' },
				credentials: null,
				layout: DEFAULT_LAYOUT,
				keywords: DEMO_KEYWORDS,
				log: {},
				createdAt: Date.now(),
				lastSync: null,
				cloud: { ...cloud, cursor: null, pending: [] },
			};
			const ws = await CloudWorkspace.create(record, CLOUD_CONFIG, (p) => (this.connecting = p));
			this.connecting = null;
			this.vaults = [...this.vaults, ws.record];
			await this.#activate(ws);
			return true;
		} catch (e) {
			this.loadError = `Couldn't open the ${service} folder: ${describeCloudError(e, service)}`;
			return false;
		} finally {
			this.connecting = null;
			this.loading = null;
		}
	}

	/** New sign-in or password for an existing cloud vault (same folder). */
	async reconnectCloud(id: string, patch: Partial<CloudState>) {
		const record = this.vaults.find((v) => v.id === id);
		if (!record?.cloud) return;
		const cloud = { ...$state.snapshot(record.cloud), ...patch };
		if (this.cloud?.record.id === id) await this.cloud.reconnect(patch);
		else {
			const { db } = await import('$lib/store/db');
			await db().vaults.update(id, { cloud });
		}
		this.vaults = this.vaults.map((v) => (v.id === id ? { ...v, cloud } : v));
		if (this.cloud?.record.id === id) void this.syncCloud();
	}

	dismissSync() {
		if (this.sync.kind !== 'busy') this.sync = { kind: 'idle' };
	}
}

/** A cloud sync failure, for people. */
export function describeCloudError(e: unknown, service = 'The service'): string {
	const err = e as { name?: string; status?: number; summary?: string; message?: string };
	if (e instanceof RemoteAuthError || err?.status === 401) return signedOut(service);
	if (e instanceof RemoteNotFound || err?.status === 404)
		return `The folder is no longer in ${service}. Was it moved or renamed?`;
	if (err?.summary?.includes('insufficient_space') || err?.status === 507)
		return `Your ${service} storage is full.`;
	if (err?.status === 429 || err?.status === 503)
		return `${service} asked us to slow down. Sync will try again shortly.`;
	if (err?.status === 403) return `${service} refused access to this folder.`;
	return (err?.message ?? String(e)).replace(`${service}: `, '');
}

const signedOut = (service: string) => `${service} signed you out. Reconnect to keep syncing.`;

/** Turn isomorphic-git and network failures into something a person can act on. */
export function describeGitError(e: unknown): string {
	const err = e as {
		code?: string;
		message?: string;
		data?: { statusCode?: number; reason?: string };
	};
	const status = err?.data?.statusCode;
	if (err?.code === 'HttpError' && (status === 401 || status === 403))
		return 'The git host refused access. Check the repository URL and that your token can read (and write) it.';
	if (err?.code === 'HttpError' && status === 404)
		return 'Repository not found. Check the URL, or add a token for private repositories.';
	if (err?.code === 'UserCanceledError')
		return 'Authentication is required. Add an access token for this repository.';
	if (err?.code === 'PushRejectedError')
		return 'The remote has commits you don’t have yet. Pull first, then push.';
	if (err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError'))
		return 'Could not reach the git host or sync proxy. Check your connection and the proxy in Settings.';
	return err?.message ?? String(e);
}

export const app = new AppState();
