/// Line diffs for reviewing uncommitted changes.

import { diffComm } from 'node-diff3';
import { linesWithEol } from './merge';

export interface DiffLine {
	kind: 'context' | 'add' | 'remove';
	text: string;
	/** Line number in the old file (context and removals). */
	oldNo: number | null;
	/** Line number in the new file (context and additions). */
	newNo: number | null;
}

export interface DiffHunk {
	oldStart: number;
	newStart: number;
	lines: DiffLine[];
}

/** Unified-diff hunks with `context` unchanged lines around each change. */
export function diffLines(before: string, after: string, context = 3): DiffHunk[] {
	const strip = (l: string) => l.replace(/\r?\n$/, '');
	const all: DiffLine[] = [];
	let o = 1;
	let n = 1;
	for (const part of diffComm(linesWithEol(before), linesWithEol(after))) {
		if (part.common) {
			for (const l of part.common)
				all.push({ kind: 'context', text: strip(l), oldNo: o++, newNo: n++ });
		} else {
			for (const l of part.buffer1 ?? [])
				all.push({ kind: 'remove', text: strip(l), oldNo: o++, newNo: null });
			for (const l of part.buffer2 ?? [])
				all.push({ kind: 'add', text: strip(l), oldNo: null, newNo: n++ });
		}
	}
	const hunks: DiffHunk[] = [];
	let current: DiffHunk | null = null;
	let lastChange = -Infinity;
	all.forEach((line, i) => {
		if (line.kind === 'context') return;
		const from = Math.max(0, i - context);
		if (!current || from > lastChange + context + 1) {
			current = {
				oldStart: all[from]!.oldNo ?? all[from]!.newNo ?? 1,
				newStart: all[from]!.newNo ?? 1,
				lines: [],
			};
			hunks.push(current);
			for (let k = from; k < i; k += 1) current.lines.push(all[k]!);
		} else {
			for (let k = lastChange + 1; k < i; k += 1) current.lines.push(all[k]!);
		}
		current.lines.push(line);
		lastChange = i;
	});
	// Trailing context after each hunk's last change.
	for (const hunk of hunks) {
		const last = hunk.lines.at(-1)!;
		const idx = all.indexOf(last);
		for (let k = idx + 1; k < Math.min(all.length, idx + 1 + context); k += 1) {
			if (all[k]!.kind !== 'context') break;
			hunk.lines.push(all[k]!);
		}
	}
	return hunks;
}
