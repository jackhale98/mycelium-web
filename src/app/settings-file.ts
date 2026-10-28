/// A portable settings file: export one vault's configuration (and this
/// browser's appearance) as JSON, and import it into another vault or
/// device. Credentials, the repository address and the commit identity are
/// never written; importing validates everything and touches only the
/// sections chosen.

import {
	configToSequences,
	formatTodoLine,
	parseTodoLine,
	sequencesToConfig,
	type CaptureTarget,
	type CaptureTemplate,
	type CaptureType,
	type KeywordConfig,
	type LogSettings,
} from '$lib/org';
import type { KeywordTone, SavedAgendaView } from '$lib/store/db';
import type { DailyFormat, VaultLayout } from '$lib/vault/layout';

export const SETTINGS_FORMAT = 'mycelium-settings';
export const SETTINGS_VERSION = 1;

export type SettingsSection = 'appearance' | 'workflow' | 'capture' | 'agenda' | 'layout';

/** org-stuck-projects, as a vault stores it. */
export interface StuckDefinition {
	match: string;
	keywords: string[];
	tags?: string[];
	regexp?: string;
}

export interface SettingsFile {
	format: typeof SETTINGS_FORMAT;
	version: number;
	exportedAt?: string;
	appearance?: { theme?: 'system' | 'light' | 'dark'; textSize?: number };
	/** TODO keywords as `#+TODO:` lines, chip colours and logging. */
	workflow?: {
		todo: string[];
		tones?: Record<string, KeywordTone>;
		log?: Partial<LogSettings>;
		autoCommit?: boolean;
	};
	capture?: { templates: CaptureTemplate[] };
	agenda?: { views: SavedAgendaView[]; stuck?: StuckDefinition };
	layout?: VaultLayout;
}

/** What can be exported: a vault record's settings plus this browser's appearance. */
export interface SettingsSource {
	theme: 'system' | 'light' | 'dark';
	textSize: number;
	keywords: KeywordConfig;
	keywordTones?: Record<string, KeywordTone> | undefined;
	log?: Partial<LogSettings> | undefined;
	autoCommit?: boolean | undefined;
	captureTemplates: CaptureTemplate[];
	agendaViews?: SavedAgendaView[] | undefined;
	stuckProjects?: StuckDefinition | undefined;
	layout: VaultLayout;
}

export function exportSettings(src: SettingsSource, now = new Date()): SettingsFile {
	return {
		format: SETTINGS_FORMAT,
		version: SETTINGS_VERSION,
		exportedAt: now.toISOString(),
		appearance: { theme: src.theme, textSize: src.textSize },
		workflow: {
			todo: configToSequences(src.keywords).map(formatTodoLine),
			...(src.keywordTones ? { tones: src.keywordTones } : {}),
			...(src.log && Object.keys(src.log).length ? { log: src.log } : {}),
			...(src.autoCommit !== undefined ? { autoCommit: src.autoCommit } : {}),
		},
		capture: { templates: src.captureTemplates },
		agenda: {
			views: src.agendaViews ?? [],
			...(src.stuckProjects ? { stuck: src.stuckProjects } : {}),
		},
		layout: src.layout,
	};
}

export function serializeSettings(file: SettingsFile): string {
	return JSON.stringify(file, null, '\t') + '\n';
}

// ------------------------------------------------------------------ parsing

class SettingsError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string): string => {
	if (typeof v !== 'string') throw new SettingsError(`${what} should be text.`);
	return v;
};

const TONES = new Set(['todo', 'next', 'wait', 'done', 'neutral']);
const TYPES = new Set<CaptureType>(['entry', 'item', 'checkitem', 'plain']);
const TEXT_SIZES = new Set([90, 100, 112.5, 125, 150]);
const FORMATS = new Set<DailyFormat>(['YYYY-MM-DD', 'YYYYMMDD']);

function template(v: unknown, i: number): CaptureTemplate {
	const where = `Capture template ${i + 1}`;
	if (!isObject(v)) throw new SettingsError(`${where} isn't an object.`);
	const type = str(v.type, `${where}'s type`) as CaptureType;
	if (!TYPES.has(type)) throw new SettingsError(`${where} has an unknown type “${type}”.`);
	const t = v.target;
	if (!isObject(t)) throw new SettingsError(`${where} needs a target.`);
	const heading =
		t.heading === null || t.heading === undefined ? null : str(t.heading, `${where}'s heading`);
	let target: CaptureTarget;
	if (t.kind === 'node') target = { kind: 'node' };
	else if (t.kind === 'daily') target = { kind: 'daily', heading };
	else if (t.kind === 'file') {
		const path = str(t.path, `${where}'s file`);
		if (!/\.org$/i.test(path) || path.includes('..'))
			throw new SettingsError(`${where}'s file should be an .org file in your notes folder.`);
		target = { kind: 'file', path, heading };
	} else throw new SettingsError(`${where} has an unknown target “${String(t.kind)}”.`);
	const key = str(v.key, `${where}'s key`);
	if (key.length !== 1) throw new SettingsError(`${where}'s key should be one character.`);
	return {
		id: typeof v.id === 'string' && v.id ? v.id : crypto.randomUUID(),
		key,
		name: str(v.name, `${where}'s name`).trim() || `Template ${i + 1}`,
		type,
		target,
		template: str(v.template, `${where}'s template`),
		...(v.prepend === true ? { prepend: true } : {}),
	};
}

/** Parse and validate a settings file; throws a readable message if it's wrong. */
export function parseSettings(text: string): SettingsFile {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new SettingsError("This isn't a JSON file.");
	}
	if (!isObject(raw) || raw.format !== SETTINGS_FORMAT)
		throw new SettingsError("This isn't a Mycelium settings file.");
	if (typeof raw.version !== 'number' || raw.version > SETTINGS_VERSION)
		throw new SettingsError('This settings file is from a newer version of Mycelium.');
	const out: SettingsFile = { format: SETTINGS_FORMAT, version: raw.version };

	if (isObject(raw.appearance)) {
		const a = raw.appearance;
		out.appearance = {};
		if (a.theme === 'system' || a.theme === 'light' || a.theme === 'dark')
			out.appearance.theme = a.theme;
		if (typeof a.textSize === 'number' && TEXT_SIZES.has(a.textSize))
			out.appearance.textSize = a.textSize;
	}

	if (isObject(raw.workflow)) {
		const w = raw.workflow;
		if (!Array.isArray(w.todo) || !w.todo.length)
			throw new SettingsError('The workflow needs at least one #+TODO line.');
		const todo = w.todo.map((l, i) => str(l, `TODO line ${i + 1}`));
		for (const line of todo) {
			const seq = parseTodoLine(line);
			if (!seq.todo.length || !seq.done.length)
				throw new SettingsError(`“${line}” needs at least one open state and one done state.`);
		}
		out.workflow = { todo };
		if (isObject(w.tones)) {
			const tones: Record<string, KeywordTone> = {};
			for (const [k, v] of Object.entries(w.tones))
				if (typeof v === 'string' && TONES.has(v)) tones[k] = v as KeywordTone;
			out.workflow.tones = tones;
		}
		if (isObject(w.log)) {
			const log: Partial<LogSettings> = {};
			if (typeof w.log.logDone === 'boolean') log.logDone = w.log.logDone;
			if (typeof w.log.logRepeat === 'boolean') log.logRepeat = w.log.logRepeat;
			if (typeof w.log.logIntoDrawer === 'string' || w.log.logIntoDrawer === null)
				log.logIntoDrawer = w.log.logIntoDrawer;
			if (typeof w.log.repeatToState === 'string' || w.log.repeatToState === null)
				log.repeatToState = w.log.repeatToState;
			out.workflow.log = log;
		}
		if (typeof w.autoCommit === 'boolean') out.workflow.autoCommit = w.autoCommit;
	}

	if (isObject(raw.capture)) {
		if (!Array.isArray(raw.capture.templates))
			throw new SettingsError('Capture templates should be a list.');
		const templates = raw.capture.templates.map(template);
		const keys = templates.map((t) => t.key);
		if (new Set(keys).size !== keys.length)
			throw new SettingsError('Two capture templates use the same key.');
		out.capture = { templates };
	}

	if (isObject(raw.agenda)) {
		if (!Array.isArray(raw.agenda.views)) throw new SettingsError('Agenda views should be a list.');
		out.agenda = {
			views: raw.agenda.views.map((v, i) => {
				if (!isObject(v)) throw new SettingsError(`Agenda view ${i + 1} isn't an object.`);
				return {
					id: typeof v.id === 'string' && v.id ? v.id : crypto.randomUUID(),
					name: str(v.name, `Agenda view ${i + 1}'s name`),
					query: str(v.query, `Agenda view ${i + 1}'s filter`),
				};
			}),
		};
		const st = raw.agenda.stuck;
		if (st !== undefined) {
			if (!isObject(st)) throw new SettingsError('Stuck projects should be an object.');
			const list = (v: unknown, what: string) => {
				if (v === undefined) return [];
				if (!Array.isArray(v)) throw new SettingsError(`${what} should be a list.`);
				return v.map((x) => str(x, what));
			};
			out.agenda.stuck = {
				match: str(st.match, 'The stuck-project match'),
				keywords: list(st.keywords, 'Stuck-project keywords'),
				tags: list(st.tags, 'Stuck-project tags'),
				regexp: st.regexp === undefined ? '' : str(st.regexp, 'The stuck-project pattern'),
			};
		}
	}

	if (isObject(raw.layout)) {
		const l = raw.layout;
		const clean = (p: unknown, what: string) => {
			const s = str(p, what).replace(/^\/+|\/+$/g, '');
			if (s.includes('..')) throw new SettingsError(`${what} can't leave the repository.`);
			return s;
		};
		const dailyFormat = (l.dailyFormat ?? 'YYYY-MM-DD') as DailyFormat;
		if (!FORMATS.has(dailyFormat))
			throw new SettingsError(`Unknown daily file format “${dailyFormat}”.`);
		out.layout = {
			roamDir: clean(l.roamDir ?? '', 'The notes folder'),
			dailyDir: clean(l.dailyDir ?? 'daily', 'The dailies folder') || 'daily',
			dailyFormat,
		};
	}
	return out;
}

/** The sections a file contains, with a short summary each, for the import dialog. */
export function describeSettings(
	file: SettingsFile,
): { section: SettingsSection; label: string }[] {
	const out: { section: SettingsSection; label: string }[] = [];
	if (file.appearance && (file.appearance.theme || file.appearance.textSize))
		out.push({
			section: 'appearance',
			label: `Appearance (${[file.appearance.theme, file.appearance.textSize && `${file.appearance.textSize}% text`].filter(Boolean).join(', ')}) · this browser`,
		});
	if (file.workflow)
		out.push({ section: 'workflow', label: `TODO keywords: ${file.workflow.todo.join('; ')}` });
	if (file.capture)
		out.push({
			section: 'capture',
			label: `Capture templates: ${file.capture.templates.map((t) => t.name).join(', ') || 'none'}`,
		});
	if (file.agenda)
		out.push({
			section: 'agenda',
			label: `Agenda views: ${file.agenda.views.map((v) => v.name).join(', ') || 'none'}${file.agenda.stuck ? `; stuck projects: ${file.agenda.stuck.match}` : ''}`,
		});
	if (file.layout)
		out.push({
			section: 'layout',
			label: `Vault layout: notes in ${file.layout.roamDir || 'the repository root'}, dailies in ${file.layout.dailyDir}/`,
		});
	return out;
}

/** The workflow section as a keyword configuration. */
export function workflowKeywords(file: SettingsFile): KeywordConfig | null {
	return file.workflow ? sequencesToConfig(file.workflow.todo.map(parseTodoLine)) : null;
}

export { SettingsError };
