/// The planner on a big vault (BENCH=1): how long a week (seven days) takes
/// to work out, on the real-world corpus plus a synthetic, task-heavy vault
/// (500 files, a few thousand headings, Effort, sessions, repeaters).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDays, appointmentsIn, sessionsOf } from '$lib/org';
import { Vault } from '$lib/vault/vault';
import { agendaDays, weekStart } from './agenda';
import { dayPlan, planDays } from './planner';

const run = process.env['BENCH'] ? describe : describe.skip;
const kw = { todoKeywords: ['TODO', 'NEXT', 'WAIT'], doneKeywords: ['DONE'] };
const today = '2026-10-29';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const stamp = (date: string, time = '') =>
	`<${date} ${DOW[new Date(`${date}T12:00`).getDay()]}${time ? ` ${time}` : ''}>`;

/** A task-heavy vault: every file a project with notes, tasks, sessions and appointments. */
function synthetic(files = 500): Record<string, string> {
	const out: Record<string, string> = {};
	let n = 0;
	for (let f = 0; f < files; f += 1) {
		const lines = [`#+title: Project ${f}`, '', 'Some notes about the project.', ''];
		for (let h = 0; h < 10; h += 1) {
			n += 1;
			const day = addDays(today, (n % 21) - 7);
			const kind = n % 10;
			if (kind < 3) {
				lines.push(`* Note ${n}`, 'Plain text, a [[id:x][link]] and more text.', '');
				continue;
			}
			lines.push(`* ${kind === 9 ? 'DONE' : n % 4 ? 'TODO' : 'NEXT'} Task ${n} :work:`);
			if (kind === 3) lines.push(`SCHEDULED: ${stamp(day)}`);
			else if (kind === 4) lines.push(`SCHEDULED: ${stamp(day, `${9 + (n % 8)}:00`)}`);
			else if (kind === 5) lines.push(`DEADLINE: ${stamp(day)}`);
			else if (kind === 6) lines.push(`SCHEDULED: ${stamp(day).replace('>', ' .+1d>')}`);
			lines.push(':PROPERTIES:', `:Effort:   ${1 + (n % 6)}:00`, ':END:');
			if (kind === 7) {
				lines.push(stamp(day, '09:00-11:00'), stamp(addDays(day, 1), '13:00-15:00'));
			}
			if (kind === 8) lines.push(`Meeting ${stamp(day, '14:00-15:00')} about it.`);
			lines.push('Body text for the task, with a few words.', '');
		}
		out[`projects/p${f}.org`] = lines.join('\n');
	}
	return out;
}

function corpus(): Record<string, string> {
	const dir = join(process.cwd(), 'tests/corpus/.cache');
	const out: Record<string, string> = {};
	for (const f of readdirSync(dir, { recursive: true }) as string[])
		if (f.endsWith('.org')) out[`corpus/${f}`] = readFileSync(join(dir, f), 'utf8');
	return out;
}

const time = (fn: () => void, runs = 5) => {
	fn(); // warm up
	const t: number[] = [];
	for (let i = 0; i < runs; i += 1) {
		const s = performance.now();
		fn();
		t.push(performance.now() - s);
	}
	return Math.min(...t);
};

run('planner on a big vault', () => {
	it('works out a week quickly', () => {
		const vault = Vault.fromSources({ ...corpus(), ...synthetic() }, kw);
		const items = vault.agenda();
		const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart(today), i));
		const rows = {
			files: vault.files.size,
			'agenda items': items.length,
			'vault.agenda() ms': time(() => vault.agenda()),
			'agendaDays, one day ms': time(() => agendaDays(vault, today, today, today)),
			'dayPlan, one day ms': time(() => dayPlan(vault, today, today)),
			'agendaDays, a week at once ms': time(() => agendaDays(vault, week[0]!, week[6]!, today)),
			'sessionsOf, every item ms': time(() =>
				items.forEach((i) => {
					const f = vault.file(i.file)!;
					sessionsOf(f.source, i.pos, f.index.keywords);
				}),
			),
			'appointmentsIn, every file ms': time(() =>
				vault.files.forEach((f) => appointmentsIn(f.source)),
			),
			'dayPlan seven times ms': time(() => week.forEach((d) => dayPlan(vault, d, today))),
			'planDays, a week ms': time(() => planDays(vault, week, today)),
			// After an edit: one file changed, so its cached sessions are read again.
			'planDays, a week after an edit ms': time(() => {
				const f = vault.file('projects/p7.org')!;
				vault.update(f.path, `${f.source}\n`);
				planDays(vault, week, today);
			}),
		};
		process.stdout.write(`${JSON.stringify(rows, null, 1)}\n`);
		expect(rows['planDays, a week ms']).toBeLessThan(100);
	});
});
