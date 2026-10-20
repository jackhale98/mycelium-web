/// Creating notes and appending captures, following org-roam's defaults.

import { detectEol, type Change } from './text';
import { formatTimestamp, makeTimestamp } from './timestamp';

/** A new file node: `:ID:` drawer then `#+title:`, as org-roam's default template writes. */
export function newNodeSource(
	title: string,
	id: string,
	options: { filetags?: string[]; eol?: string } = {},
): string {
	const eol = options.eol ?? '\n';
	const lines = [
		':PROPERTIES:',
		`:ID:       ${id}`,
		':END:',
		`#+title: ${title.replace(/[\r\n]+/g, ' ').trim()}`,
	];
	if (options.filetags?.length) lines.push(`#+filetags: :${options.filetags.join(':')}:`);
	return lines.join(eol) + eol;
}

/**
 * Append text at the end of a file, adding a terminator to the last line if
 * it lacks one and matching the file's line endings.
 */
export function appendToFile(source: string, text: string): Change[] {
	const eol = detectEol(source);
	const body = text.replace(/\r?\n/g, eol);
	const lead = source.length > 0 && !source.endsWith('\n') ? eol : '';
	return [
		{
			from: source.length,
			to: source.length,
			insert: `${lead}${body}${body.endsWith(eol) ? '' : eol}`,
		},
	];
}

/** The heading quick captures are collected under in a daily note. */
export const CAPTURE_HEADING = 'Captured';

/**
 * Add a timestamped list item (`- [2026-10-20 Tue 09:12] text`) under the
 * file's top-level `* Captured` heading, after its last line, creating the
 * heading at the end of the file the first time. Later lines of a multi-line
 * capture are indented under the item.
 */
export function captureItem(
	source: string,
	text: string,
	now: { date: string; time: string },
): Change[] {
	const eol = detectEol(source);
	const stamp = formatTimestamp(makeTimestamp({ date: now.date, time: now.time, active: false }));
	const [first = '', ...rest] = text.trim().split(/\r?\n/);
	const item = [`- ${stamp} ${first.trim()}`, ...rest.map((l) => (l.trim() ? `  ${l}` : ''))].join(
		eol,
	);

	const lines = source.split('\n');
	let offset = 0;
	let heading = -1;
	const starts: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		starts.push(offset);
		offset += lines[i]!.length + 1;
		const m = /^\*[ \t]+(.*?)[ \t]*(?::[\w@#%:]+:)?[ \t]*\r?$/.exec(lines[i]!);
		if (heading === -1 && m && m[1] === CAPTURE_HEADING) heading = i;
	}
	if (heading === -1) return appendToFile(source, `* ${CAPTURE_HEADING}${eol}${item}`);

	// The section ends at the next top-level heading; insert after its last non-blank line.
	let end = lines.length;
	for (let i = heading + 1; i < lines.length; i++)
		if (/^\*[ \t]/.test(lines[i]!)) {
			end = i;
			break;
		}
	let last = end - 1;
	while (last > heading && !lines[last]!.trim()) last--;
	const lineEnd = starts[last]! + lines[last]!.replace(/\r$/, '').length;
	return [{ from: lineEnd, to: lineEnd, insert: `${eol}${item}` }];
}

/** A capture entry as a top-level heading (org-roam-dailies' default `* %?`). */
export function captureEntry(text: string): string {
	const [first = '', ...rest] = text.trim().split(/\r?\n/);
	return [`* ${first.trim()}`, ...rest].join('\n');
}

/** org-roam's default file name: `%<%Y%m%d%H%M%S>-${slug}.org`. */
export function roamFileName(slug: string, now: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `${stamp}-${slug}.org`;
}
