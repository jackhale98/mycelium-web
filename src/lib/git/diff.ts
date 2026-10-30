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

/** Every line of both versions in order, with its line ending kept (`raw`). */
function allLines(before: string, after: string): (DiffLine & { raw: string })[] {
	const strip = (l: string) => l.replace(/\r?\n$/, '');
	const all: (DiffLine & { raw: string })[] = [];
	let o = 1;
	let n = 1;
	for (const part of diffComm(linesWithEol(before), linesWithEol(after))) {
		if (part.common) {
			for (const l of part.common)
				all.push({ kind: 'context', text: strip(l), raw: l, oldNo: o++, newNo: n++ });
		} else {
			for (const l of part.buffer1 ?? [])
				all.push({ kind: 'remove', text: strip(l), raw: l, oldNo: o++, newNo: null });
			for (const l of part.buffer2 ?? [])
				all.push({ kind: 'add', text: strip(l), raw: l, oldNo: null, newNo: n++ });
		}
	}
	return all;
}

/** Unified-diff hunks with `context` unchanged lines around each change. */
export function diffLines(before: string, after: string, context = 3): DiffHunk[] {
	const all = allLines(before, after);
	const hunks: (DiffHunk & { at: number[] })[] = [];
	let current: (DiffHunk & { at: number[] }) | null = null;
	let lastChange = -Infinity;
	all.forEach((line, i) => {
		if (line.kind === 'context') return;
		const from = Math.max(0, i - context);
		if (!current || from > lastChange + context + 1) {
			current = {
				oldStart: all[from]!.oldNo ?? all[from]!.newNo ?? 1,
				newStart: all[from]!.newNo ?? 1,
				lines: [],
				at: [],
			};
			hunks.push(current);
			for (let k = from; k < i; k += 1) current.at.push(k);
		} else {
			for (let k = lastChange + 1; k < i; k += 1) current.at.push(k);
		}
		current.at.push(i);
		lastChange = i;
	});
	// Trailing context after each hunk's last change.
	for (const hunk of hunks) {
		const idx = hunk.at.at(-1)!;
		for (let k = idx + 1; k < Math.min(all.length, idx + 1 + context); k += 1) {
			if (all[k]!.kind !== 'context') break;
			hunk.at.push(k);
		}
	}
	return hunks.map(({ at, ...h }) => ({
		...h,
		lines: at.map((k) => {
			const { raw: _, ...line } = all[k]!;
			return line;
		}),
	}));
}

/** Changed line indexes split where unchanged lines come between. */
function blocksOf(lines: number[]): number[][] {
	const out: number[][] = [];
	lines.forEach((i, n) => {
		if (n === 0 || i !== lines[n - 1]! + 1) out.push([]);
		out.at(-1)!.push(i);
	});
	return out;
}

/** For each line of a hunk, which of its changes (0, 1, …) it belongs to; null for context. */
export function hunkBlocks(hunk: DiffHunk): (number | null)[] {
	let n = -1;
	return hunk.lines.map((l, i) => {
		if (l.kind === 'context') return null;
		if (i === 0 || hunk.lines[i - 1]!.kind === 'context') n += 1;
		return n;
	});
}

/**
 * `after` with one hunk's changes undone (its lines as they were in
 * `before`), the other hunks left as they are: reverting one block of a
 * changed file. `hunk` is its index in `diffLines(before, after)`; with
 * `block`, only that one of the hunk's changes (as `hunkBlocks` numbers them).
 */
export function revertHunk(
	before: string,
	after: string,
	hunk: number,
	context = 3,
	block?: number,
): string {
	const all = allLines(before, after);
	// The changed lines of each hunk, grouped as diffLines groups them.
	const groups: number[][] = [];
	let last = -Infinity;
	all.forEach((line, i) => {
		if (line.kind === 'context') return;
		if (!groups.length || i - context > last + context + 1) groups.push([]);
		groups.at(-1)!.push(i);
		last = i;
	});
	let lines = groups[hunk] ?? [];
	// One change inside the hunk: its run of changed lines, `block` in order.
	if (block !== undefined) lines = blocksOf(lines)[block] ?? [];
	const chosen = new Set(lines);
	let out = '';
	all.forEach((line, i) => {
		if (line.kind === 'context') out += line.raw;
		else if (chosen.has(i)) {
			if (line.kind === 'remove') out += line.raw;
		} else if (line.kind === 'add') out += line.raw;
	});
	return out;
}
