export interface RenderContext {
	/** Vault-relative path of the file being rendered. */
	path: string;
	/** Subtracted from headline levels so a page's top headings render as h2. */
	levelOffset: number;
	/** Checkboxes and TODO keywords can be changed. */
	interactive: boolean;
	/** Links to this node id are emphasised (used in backlink snippets). */
	highlight?: string | undefined;
}

/** Only these schemes become clickable external links. */
export const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
export const isImagePath = (path: string) => IMAGE_RE.test(path);
