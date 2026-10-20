/// Three-way text merge for org files.
///
/// Lines are merged with diff3 while keeping each line's own terminator, so a
/// clean merge reproduces the exact bytes both sides wrote — no newline
/// normalisation, no re-serialisation.

import { diff3Merge } from 'node-diff3';

export interface MergeHunk {
	/** Lines both sides agree on (or that only one side changed). */
	ok?: string;
	conflict?: { ours: string; base: string; theirs: string };
}

export interface MergeResult {
	clean: boolean;
	/** The merged text; when not clean, conflicting hunks take `ours`. */
	text: string;
	hunks: MergeHunk[];
}

/** Split text into lines that keep their terminators. */
export function linesWithEol(text: string): string[] {
	return text.length === 0 ? [] : text.split(/(?<=\n)/);
}

/**
 * diff3 (like git) treats edits to *adjacent* lines as a conflict. In org files
 * that is the common case — two devices each completing a different task in
 * the same list — so when both sides kept the line count, merge line by line
 * and only conflict where the same line changed differently.
 */
function mergeLineByLine(base: string[], ours: string[], theirs: string[]): string | null {
	if (base.length !== ours.length || base.length !== theirs.length) return null;
	let out = '';
	for (let i = 0; i < base.length; i += 1) {
		const [b, o, t] = [base[i]!, ours[i]!, theirs[i]!];
		if (o === t || t === b) out += o;
		else if (o === b) out += t;
		else return null;
	}
	return out;
}

export function mergeText(base: string, ours: string, theirs: string): MergeResult {
	if (ours === theirs) return { clean: true, text: ours, hunks: [{ ok: ours }] };
	if (base === ours) return { clean: true, text: theirs, hunks: [{ ok: theirs }] };
	if (base === theirs) return { clean: true, text: ours, hunks: [{ ok: ours }] };
	const blocks = diff3Merge(linesWithEol(ours), linesWithEol(base), linesWithEol(theirs), {
		excludeFalseConflicts: true,
	});
	const hunks: MergeHunk[] = [];
	let clean = true;
	let text = '';
	for (const block of blocks) {
		if (block.ok) {
			const ok = block.ok.join('');
			hunks.push({ ok });
			text += ok;
		} else if (block.conflict) {
			const { a, o, b } = block.conflict;
			const refined = mergeLineByLine(o, a, b);
			if (refined !== null) {
				hunks.push({ ok: refined });
				text += refined;
				continue;
			}
			clean = false;
			const conflict = { ours: a.join(''), base: o.join(''), theirs: b.join('') };
			hunks.push({ conflict });
			text += conflict.ours;
		}
	}
	return { clean, text, hunks };
}
