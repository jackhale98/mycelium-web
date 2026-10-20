/// Application state shared across views. The vault is a mutable model, so a
/// revision counter tells Svelte when derived views must recompute.

import {
	appendToFile,
	applyChanges,
	captureEntry,
	changeTodoState,
	newNodeSource,
	parseOrg,
	toggleCheckbox,
	type OrgData,
} from '$lib/org';
import { buildSearch } from '$lib/vault/search';
import { Vault } from '$lib/vault/vault';
import { demoSources } from './demo';

export type ThemeChoice = 'system' | 'light' | 'dark';

const THEME_KEY = 'mycelium:theme';

function readTheme(): ThemeChoice {
	try {
		const t = localStorage.getItem(THEME_KEY);
		return t === 'light' || t === 'dark' ? t : 'system';
	} catch {
		return 'system';
	}
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

class AppState {
	vault: Vault = Vault.fromSources(demoSources, {
		todoKeywords: ['TODO', 'NEXT'],
		doneKeywords: ['DONE'],
	});
	/** Bumped on every vault change. */
	rev = $state(0);
	theme = $state<ThemeChoice>(readTheme());
	paletteOpen = $state(false);
	panelOpen = $state(true);
	navOpen = $state(false);
	/** Paths edited in this session that are not yet synced. */
	dirty = $state<string[]>([]);
	readonly demo = true;

	#search = $derived.by(() => {
		void this.rev;
		return buildSearch(this.vault);
	});
	#trees = new Map<string, { source: string; tree: OrgData }>();

	get search() {
		return this.#search;
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
		try {
			if (choice === 'system') localStorage.removeItem(THEME_KEY);
			else localStorage.setItem(THEME_KEY, choice);
		} catch {}
		if (choice === 'system') delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = choice;
	}

	#write(path: string, text: string) {
		this.vault.update(path, text);
		if (!this.dirty.includes(path)) this.dirty = [...this.dirty, path];
		this.rev += 1;
	}

	/** Path of the daily note for a date, existing or not. */
	dailyPath(date: string): string {
		return `${this.dailyDir}/${date}.org`;
	}

	readonly dailyDir = 'daily';

	/** Daily note dates present in the vault, newest first. */
	get dailies(): string[] {
		void this.rev;
		const prefix = `${this.dailyDir}/`;
		return [...this.vault.files.keys()]
			.filter((p) => p.startsWith(prefix))
			.map((p) => p.slice(prefix.length).replace(/\.org$/, ''))
			.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
			.sort()
			.reverse();
	}

	/** Create the daily note for `date` if missing; returns its node id. */
	ensureDaily(date: string): string | null {
		const path = this.dailyPath(date);
		if (!this.vault.file(path)) this.#write(path, newNodeSource(date, crypto.randomUUID()));
		return this.vault.fileNode(path)?.id ?? null;
	}

	/** Append a capture to today's daily note. */
	capture(text: string): string | null {
		if (!text.trim()) return null;
		const { date } = localNow();
		const id = this.ensureDaily(date);
		const path = this.dailyPath(date);
		const file = this.vault.file(path)!;
		this.#write(path, applyChanges(file.source, appendToFile(file.source, captureEntry(text))));
		return id;
	}

	toggleCheckbox(path: string, offset: number) {
		const file = this.vault.file(path);
		if (!file) return;
		const result = toggleCheckbox(file.source, offset);
		if (result.steps.length > 0) this.#write(path, result.text);
	}

	setTodo(path: string, offset: number, keyword: string | null) {
		const file = this.vault.file(path);
		if (!file) return;
		const result = changeTodoState(file.source, offset, keyword, {
			config: file.index.keywords,
			now: localNow(),
		});
		if (result.steps.length > 0) this.#write(path, result.text);
	}
}

export const app = new AppState();
