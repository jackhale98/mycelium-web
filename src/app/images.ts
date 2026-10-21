/// Making a picture smaller before it goes into the vault: at most 2000px
/// on its longer side, as JPEG (or PNG when it has see-through parts, like
/// a screenshot with transparency). Re-encoding also drops the photo's
/// metadata, including where it was taken. Animated GIFs and SVGs are kept
/// as they are.

export interface Prepared {
	bytes: Uint8Array;
	type: string;
	ext: string;
	width: number;
	height: number;
}

const MAX_SIDE = 2000;
const QUALITY = 0.82;

const EXT: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'image/avif': 'avif',
};

/** The picture exactly as chosen. */
export async function original(file: File): Promise<Prepared> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const size = await dimensions(file).catch(() => ({ width: 0, height: 0 }));
	const ext = EXT[file.type] ?? (/\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() || 'img');
	return { bytes, type: file.type, ext, ...size };
}

async function dimensions(file: File) {
	const bmp = await createImageBitmap(file);
	const size = { width: bmp.width, height: bmp.height };
	bmp.close();
	return size;
}

/** Can this picture be made smaller (not animated, not a drawing)? */
export const canShrink = (file: File) => !/^image\/(gif|svg\+xml)$/.test(file.type);

/** The picture resized and re-encoded, or null if the browser can't read it. */
export async function shrink(file: File): Promise<Prepared | null> {
	let bmp: ImageBitmap;
	try {
		// Turned the right way up, as the camera recorded it.
		bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		return null;
	}
	const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
	const width = Math.max(1, Math.round(bmp.width * scale));
	const height = Math.max(1, Math.round(bmp.height * scale));
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bmp, 0, 0, width, height);
	bmp.close();
	const transparent = file.type !== 'image/jpeg' && hasTransparency(ctx, width, height);
	const type = transparent ? 'image/png' : 'image/jpeg';
	const blob = await canvas.convertToBlob(transparent ? { type } : { type, quality: QUALITY });
	return { bytes: new Uint8Array(await blob.arrayBuffer()), type, ext: EXT[type]!, width, height };
}

/** Any see-through pixels? (Sampled: a full scan of a big picture isn't needed.) */
function hasTransparency(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): boolean {
	const data = ctx.getImageData(0, 0, w, h).data;
	const step = Math.max(1, Math.floor((w * h) / 200_000)) * 4;
	for (let i = 3; i < data.length; i += step) if (data[i]! < 250) return true;
	return false;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
