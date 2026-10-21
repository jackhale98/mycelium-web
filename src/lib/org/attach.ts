/// Attachments as `org-attach` lays them out: which folder belongs to an
/// entry, and where an `attachment:` link points.
///
/// `org-attach-dir`: the entry's `:DIR:` (or deprecated `:ATTACH_DIR:`),
/// relative to the file's folder; else its `:ID:` under `org-attach-id-dir`
/// ("data/"), split by the first of `org-attach-id-to-path-function-list`
/// whose folder exists: `ab/cdef…` (UUIDs), `202610/21T…` (timestamp IDs),
/// `__/a/abc…` (fallback). Inheritance follows `org-use-property-inheritance`,
/// off by default, so only the entry's own properties count. Text before the
/// first heading belongs to the file-level property drawer.

import { owningHeadline } from './headline';
import { resolvePath } from './links';
import { getProperties } from './properties';
import { splitLines } from './text';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig } from './types';

/** `org-attach-id-dir`'s default. */
export const ATTACH_ID_DIR = 'data';

/** Folder layouts for an ID, in `org-attach-id-to-path-function-list` order. */
export function idFolders(id: string): string[] {
	const out: string[] = [];
	if (id.length > 2) out.push(`${id.slice(0, 2)}/${id.slice(2)}`);
	if (id.length > 6) out.push(`${id.slice(0, 6)}/${id.slice(6)}`);
	if (id.length > 0) out.push(`__/${id.slice(0, 1)}/${id}`);
	return out;
}

/**
 * The attachment folders an entry may use (vault paths), best first: try
 * them in order and use the first that exists. Empty when the entry has
 * neither `:DIR:` nor `:ID:` (Org has no attachment folder then).
 */
export function attachmentDirs(
	source: string,
	offset: number,
	filePath: string,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): string[] {
	const lines = splitLines(source);
	const h = owningHeadline(source, offset, config, lines);
	const props = getProperties(source, h ? h.line.from : null, config);
	const dir = props['DIR'] ?? props['ATTACH_DIR'];
	if (dir) {
		const p = resolvePath(filePath, dir.trim().replace(/\/+$/, ''));
		return p === null ? [] : [p];
	}
	const id = props['ID']?.trim();
	if (!id) return [];
	const base = resolvePath(filePath, ATTACH_ID_DIR);
	return base === null ? [] : idFolders(id).map((f) => `${base}/${f}`);
}

/** Where `[[attachment:name]]` may be, best first (the first that exists wins). */
export function attachmentCandidates(
	source: string,
	offset: number,
	filePath: string,
	name: string,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): string[] {
	const clean = name.replace(/::.*$/, '');
	return attachmentDirs(source, offset, filePath, config).map((d) => (d ? `${d}/${clean}` : clean));
}

/** Image extensions Emacs previews (`image-file-name-extensions`), any case. */
const IMAGE_RE = /\.(png|jpe?g|gif|tiff?|xbm|xpm|pbm|pgm|ppm|pnm|svg|webp)$/i;
export const isImageFile = (path: string) => IMAGE_RE.test(path.replace(/::.*$/, ''));
