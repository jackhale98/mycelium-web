/// Which vault files are text (org and friends) and which are binary
/// attachments, and their media types.

const TEXT = /\.(org|org_archive|txt|md|csv|tsv|el|json|ya?ml|tex|bib|html?|css|js|ts|py|sh)$/i;

/** Text files are edited and merged; anything else is kept as bytes. */
export const isTextPath = (path: string) => TEXT.test(path);

const TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	pdf: 'application/pdf',
	mp3: 'audio/mpeg',
	mp4: 'video/mp4',
	webm: 'video/webm',
	txt: 'text/plain',
};

export function mediaType(path: string): string {
	const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
	return TYPES[ext] ?? 'application/octet-stream';
}
