/// Where pictures added from the app go, and how a note links to them: a
/// shared folder (`images/` unless the vault says otherwise), names that
/// sort by date and don't collide, and links relative to the note, as
/// `org-insert-link` writes them for a file in the same project.

/** `images/2026-10-21-143205-cat.jpg`: date and time first, then a tidy form of the original name. */
export function imagePath(dir: string, original: string, ext: string, now: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	const base = original
		.replace(/\.[^.]*$/, '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	// Phone cameras name everything IMG_1234: the date says more.
	const name =
		!base || /^(img|image|photo|pxl|dsc|screenshot)[-_]?\d*$/.test(base) ? '' : `-${base}`;
	const folder = dir.replace(/^\/+|\/+$/g, '');
	return `${folder ? `${folder}/` : ''}${stamp}${name}.${ext}`;
}

/** The path of `target` relative to the folder holding `from` (both relative to the vault). */
export function relativeTo(from: string, target: string): string {
	const a = from.split('/').slice(0, -1);
	const b = target.split('/');
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i += 1;
	return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/** The org link for a picture at `image` from the note at `note`. */
export function imageLink(note: string, image: string): string {
	return `[[file:${relativeTo(note, image)}]]`;
}
