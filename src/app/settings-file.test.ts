import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPTURE_TEMPLATES, parseTodoLine, sequencesToConfig } from '$lib/org';
import {
	describeSettings,
	exportSettings,
	parseSettings,
	serializeSettings,
	workflowKeywords,
	type SettingsSource,
} from './settings-file';

const source: SettingsSource = {
	theme: 'dark',
	textSize: 125,
	keywords: sequencesToConfig([
		parseTodoLine('TODO(t) NEXT(n) WAIT(w@/!) | DONE(d!) CANCELLED(c@)'),
	]),
	keywordTones: { NEXT: 'next' },
	log: { logDone: true },
	autoCommit: false,
	captureTemplates: DEFAULT_CAPTURE_TEMPLATES,
	agendaViews: [{ id: 'v1', name: 'Work', query: 'tag=%2Bwork' }],
	layout: { roamDir: 'roam', dailyDir: 'daily', dailyFormat: 'YYYY-MM-DD' },
};

describe('settings file', () => {
	it('round-trips everything it exports', () => {
		const text = serializeSettings(exportSettings(source, new Date('2026-10-20T12:00:00Z')));
		const file = parseSettings(text);
		expect(file.appearance).toEqual({ theme: 'dark', textSize: 125 });
		expect(file.workflow?.todo).toEqual(['TODO(t) NEXT(n) WAIT(w@/!) | DONE(d!) CANCELLED(c@)']);
		expect(workflowKeywords(file)?.todoKeywords).toEqual(['TODO', 'NEXT', 'WAIT']);
		expect(file.workflow?.tones).toEqual({ NEXT: 'next' });
		expect(file.workflow?.log).toEqual({ logDone: true });
		expect(file.capture?.templates).toEqual(DEFAULT_CAPTURE_TEMPLATES);
		expect(file.agenda?.views).toEqual(source.agendaViews);
		expect(file.layout).toEqual(source.layout);
		expect(describeSettings(file).map((s) => s.section)).toEqual([
			'appearance',
			'workflow',
			'capture',
			'agenda',
			'layout',
		]);
	});

	it('never contains credentials or the repository address', () => {
		const text = serializeSettings(
			exportSettings({
				...source,
				...({ credentials: { token: 'ghp_secret' }, url: 'https://x' } as object),
			}),
		);
		expect(text).not.toContain('ghp_secret');
		expect(text).not.toContain('credentials');
		expect(text).not.toContain('https://x');
	});

	it('imports only the sections a file has, ignoring unknown keys', () => {
		const file = parseSettings(
			JSON.stringify({
				format: 'mycelium-settings',
				version: 1,
				credentials: { token: 'x' },
				capture: {
					templates: [
						{
							key: 'i',
							name: 'Idea',
							type: 'item',
							target: { kind: 'file', path: 'ideas.org', heading: null },
							template: '%?',
						},
					],
				},
			}),
		);
		expect(Object.keys(file)).toEqual(['format', 'version', 'capture']);
		expect(file.capture?.templates[0]).toMatchObject({
			key: 'i',
			target: { kind: 'file', path: 'ideas.org' },
		});
		expect(file.capture?.templates[0]?.id).toBeTruthy();
	});

	it('explains what is wrong with a bad file', () => {
		const bad = (o: object) => () =>
			parseSettings(JSON.stringify({ format: 'mycelium-settings', version: 1, ...o }));
		expect(() => parseSettings('{')).toThrow("isn't a JSON file");
		expect(() => parseSettings('{"format":"other"}')).toThrow("isn't a Mycelium settings file");
		expect(() => parseSettings('{"format":"mycelium-settings","version":9}')).toThrow(
			'newer version',
		);
		expect(bad({ workflow: { todo: ['TODO'] } })).toThrow('at least one open state');
		const tpl = (o: object) => ({
			capture: {
				templates: [
					{
						key: 'a',
						name: 'A',
						type: 'item',
						target: { kind: 'daily', heading: null },
						template: '',
						...o,
					},
				],
			},
		});
		expect(bad(tpl({ type: 'list' }))).toThrow('unknown type');
		expect(bad(tpl({ target: { kind: 'file', path: '../etc/x.org' } }))).toThrow(
			'in your notes folder',
		);
		expect(bad(tpl({ key: 'ab' }))).toThrow('one character');
		expect(bad({ layout: { roamDir: '../up' } })).toThrow("can't leave the repository");
	});
});
