/// Note-level edits org-roam offers: retitling a file note, updating the
/// descriptions of links to a renamed note, and extracting a heading into a
/// note of its own (`org-roam-extract-subtree`). All return text changes, or
/// new file text, touching only what they must.

import { scanHeadline } from './headline';
import { findPlanning } from './planning';
import { findPropertyDrawer } from './properties';
import { subtreeAt, shiftLevels } from './refile';
import { splitLines, type Change } from './text';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig } from './types';

const eolOf = (source: string) => (source.includes('\r\n') ? '\r\n' : '\n');
const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();

/** Set a file's `#+title:` (adding it after the file's property drawer when missing). */
export function setFileTitle(source: string, title: string): Change[] {
	const clean = oneLine(title);
	const m = /^([ \t]*#\+title:[ \t]*)(.*?)[ \t]*$/im.exec(source);
	if (m) {
		const from = m.index + m[1]!.length;
		return m[2] === clean ? [] : [{ from, to: from + m[2]!.length, insert: clean }];
	}
	const eol = eolOf(source);
	const drawer = findPropertyDrawer(source, null);
	const at = drawer ? drawer.end.end : 0;
	const lead = at > 0 && source[at - 1] !== '\n' ? eol : '';
	return [{ from: at, to: at, insert: `${lead}#+title: ${clean}${eol}` }];
}

/** Every `[[id:<id>][…]]` link, with where its description sits. */
function* idLinks(source: string, id: string) {
	const re = /\[\[id:([^\]\s]+)\]\[([^\]]*)\]\]/g;
	for (let m = re.exec(source); m; m = re.exec(source))
		if (m[1] === id) {
			const from = m.index + 2 + 3 + m[1].length + 2;
			yield { from, to: from + m[2]!.length, description: m[2]! };
		}
}

/**
 * After renaming a note, the links to it whose description was its old
 * title, now with the new one. Other descriptions (an alias, a phrase) are
 * left as written.
 */
export function renameLinkDescriptions(
	source: string,
	id: string,
	oldTitle: string,
	newTitle: string,
): Change[] {
	const clean = oneLine(newTitle).replace(/[[\]]/g, '');
	const changes: Change[] = [];
	for (const link of idLinks(source, id))
		if (link.description === oldTitle && oldTitle !== clean)
			changes.push({ from: link.from, to: link.to, insert: clean });
	return changes;
}

export interface Extracted {
	/** Changes to the original file: the subtree replaced by a link heading (or removed). */
	changes: Change[];
	/** The new note's text. */
	text: string;
	title: string;
	id: string;
}

/**
 * `org-roam-extract-subtree`: the heading at `offset` becomes a note of its
 * own. Its property drawer becomes the file's (with its `:ID:`, `id` when it
 * has none), its title `#+title:`, its own tags `#+filetags:`, and its
 * children move up to level 1 and below. Where it was, a heading at the
 * same level links to it (or, with `leaveLink` off, nothing).
 */
export function extractSubtree(
	source: string,
	offset: number,
	id: string,
	options: { leaveLink?: boolean; config?: KeywordConfig } = {},
): Extracted | null {
	const config = options.config ?? DEFAULT_KEYWORD_CONFIG;
	const tree = subtreeAt(source, offset, config);
	if (!tree) return null;
	const eol = eolOf(source);
	const text = tree.text;
	const lines = splitLines(text);
	const head = scanHeadline(lines[0]!, config);
	if (!head) return null;
	const title = head.title.value.trim();
	const tags = head.tags?.values ?? [];

	// The heading's own lines: planning, then the property drawer.
	const planning = findPlanning(lines, head);
	const drawer = findPropertyDrawer(text, 0, config, lines);
	const props = drawer?.properties ?? [];
	const ownId = props.find((p) => p.key.toUpperCase() === 'ID')?.value || id;
	const bodyStart = Math.max(lines[0]!.end, planning?.line.end ?? 0, drawer ? drawer.end.end : 0);

	const out: string[] = [':PROPERTIES:'];
	if (!props.some((p) => p.key.toUpperCase() === 'ID')) out.push(`:ID:       ${ownId}`);
	for (const p of props) out.push(p.line.text.trim());
	out.push(':END:', `#+title: ${title}`);
	if (tags.length) out.push(`#+filetags: :${tags.join(':')}:`);
	if (planning) out.push(planning.line.text.trim());
	const body = shiftLevels(text.slice(bodyStart), -tree.level).replace(/^(?:[ \t]*\r?\n)+/, '');
	const note = out.join(eol) + eol + (body ? body.replace(/[ \t\r\n]*$/, '') + eol : '');

	const link = `${'*'.repeat(tree.level)} [[id:${ownId}][${title.replace(/[[\]]/g, '')}]]${eol}`;
	// Keep the blank lines that followed the subtree.
	const blank = /\n((?:[ \t]*\r?\n)*)$/.exec(text)?.[1] ?? '';
	return {
		changes: [
			{
				from: tree.from,
				to: tree.to,
				insert: options.leaveLink === false ? blank : link + blank,
			},
		],
		text: note,
		title,
		id: ownId,
	};
}
