export interface RenderContext {
	/** Vault-relative path of the file being rendered. */
	path: string;
	/** Subtracted from headline levels so a page's top headings render as h2. */
	levelOffset: number;
	/** Checkboxes and TODO keywords can be changed. */
	interactive: boolean;
	/** Links to this node id are emphasised (used in backlink snippets). */
	highlight?: string | undefined;
	/** Transclusions being shown around this one (to stop loops). */
	transcluding?: string[] | undefined;
	/** `#+ATTR_ORG:` / `#+ATTR_HTML:` of the paragraph, for its inline images. */
	image?: ImageAttrs | undefined;
}

export interface ImageAttrs {
	/** A CSS width (`300px`, `50%`), or `null` for the image's own size. */
	width: string | null;
	align: 'left' | 'center' | 'right' | null;
}

/** `:key value :key2 value2` → a map (keys lower-cased, without the colon). */
function attrPairs(value: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of value.matchAll(/:([\w-]+)\s+((?:(?!\s:[\w-]+(?:\s|$)).)*)/g))
		out[m[1]!.toLowerCase()] = m[2]!.trim();
	return out;
}

/**
 * Image width and alignment from a paragraph's affiliated keywords, as
 * `org-display-inline-image--width` and `org-image--align` read them:
 * `#+ATTR_ORG:` first, then any other `#+ATTR_…`. Widths are pixels (`300`,
 * `300px`), percentages (`50%`), or a fraction of the text width (`0.5`).
 */
export function imageAttrs(affiliated: Record<string, unknown> | undefined): ImageAttrs {
	const lists = Object.entries(affiliated ?? {})
		.filter(([k]) => /^ATTR_/i.test(k))
		.sort(([a], [b]) =>
			a.toUpperCase() === 'ATTR_ORG' ? -1 : b.toUpperCase() === 'ATTR_ORG' ? 1 : 0,
		)
		.map(([, v]) =>
			attrPairs((Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string').join(' ')),
		);
	let width: string | null = null;
	for (const attrs of lists) {
		const w = attrs['width'];
		if (!w) continue;
		if (w === 't') break;
		let m = /^\+?(\d+)(?:px)?$/.exec(w);
		if (m) {
			width = `${m[1]}px`;
			break;
		}
		m = /^\+?([\d.]+)%/.exec(w);
		if (m) {
			width = `${Number(m[1])}%`;
			break;
		}
		m = /^(\d*\.\d+)/.exec(w);
		if (m && Number(m[1]) <= 2) {
			width = `${Math.round(Number(m[1]) * 100)}%`;
			break;
		}
	}
	let align: ImageAttrs['align'] = null;
	for (const attrs of lists) {
		if (attrs['center'] === 't') align = 'center';
		else if (/^(left|center|right)$/.test(attrs['align'] ?? ''))
			align = attrs['align'] as ImageAttrs['align'];
		if (align) break;
	}
	return { width, align };
}

/** Only these schemes become clickable external links. */
export const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
export const isImagePath = (path: string) => IMAGE_RE.test(path);
