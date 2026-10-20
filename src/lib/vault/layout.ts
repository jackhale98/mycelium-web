/// Where things live in a vault: the org-roam directory, the dailies folder
/// and how daily files are named. Detected from the repository's contents,
/// overridable in settings (we cannot read the user's Emacs config).

export type DailyFormat = 'YYYY-MM-DD' | 'YYYYMMDD';

export interface VaultLayout {
	/** Repo-relative org-roam directory; `''` is the repository root. */
	roamDir: string;
	/** Dailies directory relative to `roamDir` (org-roam's default is `daily/`). */
	dailyDir: string;
	dailyFormat: DailyFormat;
}

export const DEFAULT_LAYOUT: VaultLayout = {
	roamDir: '',
	dailyDir: 'daily',
	dailyFormat: 'YYYY-MM-DD',
};

const DAILY_NAMES = ['daily', 'dailies', 'journal', 'journals'];
const join = (...parts: string[]) => parts.filter(Boolean).join('/');

function dirname(path: string): string {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i);
}

function commonDir(paths: string[]): string {
	if (paths.length === 0) return '';
	let prefix = dirname(paths[0]!).split('/').filter(Boolean);
	for (const p of paths.slice(1)) {
		const parts = dirname(p).split('/').filter(Boolean);
		let i = 0;
		while (i < prefix.length && prefix[i] === parts[i]) i += 1;
		prefix = prefix.slice(0, i);
	}
	return prefix.join('/');
}

/**
 * Infer the layout from org file paths and which of them hold an org-roam
 * `:ID:`. The roam directory is the deepest folder containing every node file.
 */
export function detectLayout(files: { path: string; hasId: boolean }[]): VaultLayout {
	const nodes = files.filter((f) => f.hasId).map((f) => f.path);
	const roamDir = commonDir(nodes.length > 0 ? nodes : files.map((f) => f.path));
	const inRoam = files.map((f) => f.path).filter((p) => !roamDir || p.startsWith(`${roamDir}/`));
	const rel = (p: string) => (roamDir ? p.slice(roamDir.length + 1) : p);

	let best: { dir: string; format: DailyFormat; count: number } | null = null;
	for (const name of DAILY_NAMES) {
		for (const format of ['YYYY-MM-DD', 'YYYYMMDD'] as const) {
			const re = format === 'YYYY-MM-DD' ? /^\d{4}-\d{2}-\d{2}\.org$/ : /^\d{8}\.org$/;
			const count = inRoam.filter((p) => {
				const r = rel(p);
				return r.startsWith(`${name}/`) && re.test(r.slice(name.length + 1));
			}).length;
			if (count > 0 && (!best || count > best.count)) best = { dir: name, format, count };
		}
	}
	return { roamDir, dailyDir: best?.dir ?? 'daily', dailyFormat: best?.format ?? 'YYYY-MM-DD' };
}

/** Repo-relative path of the daily note for `date` (`YYYY-MM-DD`). */
export function dailyPath(layout: VaultLayout, date: string): string {
	const name = layout.dailyFormat === 'YYYYMMDD' ? date.replaceAll('-', '') : date;
	return join(layout.roamDir, layout.dailyDir, `${name}.org`);
}

/** The date a path is the daily note for, or `null`. */
export function dailyDate(layout: VaultLayout, path: string): string | null {
	const dir = join(layout.roamDir, layout.dailyDir);
	if (!path.startsWith(`${dir}/`)) return null;
	const name = path.slice(dir.length + 1);
	const m =
		layout.dailyFormat === 'YYYYMMDD'
			? /^(\d{4})(\d{2})(\d{2})\.org$/.exec(name)
			: /^(\d{4})-(\d{2})-(\d{2})\.org$/.exec(name);
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** `true` when `path` is an org file org-roam would index for this layout. */
export function inVault(layout: VaultLayout, path: string): boolean {
	return (
		path.toLowerCase().endsWith('.org') &&
		(!layout.roamDir || path.startsWith(`${layout.roamDir}/`))
	);
}

/** Path for a new node file: `%<%Y%m%d%H%M%S>-${slug}.org` in the roam directory. */
export function nodePath(layout: VaultLayout, fileName: string): string {
	return join(layout.roamDir, fileName);
}

const KNOWN_TODO = [
	'TODO',
	'NEXT',
	'STARTED',
	'DOING',
	'WAITING',
	'WAIT',
	'HOLD',
	'SOMEDAY',
	'PROJ',
	'IDEA',
];
const KNOWN_DONE = ['DONE', 'CANCELLED', 'CANCELED', 'CANCEL', 'KILL', 'FIXED'];

/**
 * Guess the user's global `org-todo-keywords` from how headlines start, since
 * per-file `#+TODO:` lines are honoured separately. A keyword counts once it
 * opens at least two headlines; TODO and DONE are always included.
 */
export function detectKeywords(sources: Iterable<string>): {
	todoKeywords: string[];
	doneKeywords: string[];
} {
	const counts = new Map<string, number>();
	const re = /^\*+[ \t]+([A-Z]+)(?=[ \t]|$)/gm;
	for (const s of sources) {
		re.lastIndex = 0;
		for (let m = re.exec(s); m; m = re.exec(s)) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
	}
	const seen = (k: string) => (counts.get(k) ?? 0) >= 2;
	return {
		todoKeywords: ['TODO', ...KNOWN_TODO.filter((k) => k !== 'TODO' && seen(k))],
		doneKeywords: ['DONE', ...KNOWN_DONE.filter((k) => k !== 'DONE' && seen(k))],
	};
}
