/// Creating notes and appending captures, following org-roam's defaults.

import { detectEol, type Change } from './text';

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
