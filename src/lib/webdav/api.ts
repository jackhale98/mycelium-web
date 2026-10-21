/// WebDAV (Nextcloud, ownCloud, Synology, Koofr, Fastmail Files, Apache…).
///
/// WebDAV has no change feed, so each sync lists the folder. Nextcloud and
/// ownCloud change a folder's ETag whenever anything inside it changes, so
/// unchanged subfolders are reused from the last listing. Writes carry the
/// file's ETag (`If-Match`), so a file changed elsewhere is merged, not
/// overwritten. Most servers don't allow cross-origin requests, so requests
/// usually go through the sync worker's `/dav/` relay.

import {
	pool,
	RemoteAuthError,
	RemoteConflict,
	RemoteError,
	RemoteNotFound,
	type RemoteBrowser,
	type RemoteEntry,
	type RemoteFiles,
	type RemoteListing,
} from '$lib/sync/remote';

export interface WebDavConfig {
	/** The WebDAV address, e.g. `https://cloud.example.com/remote.php/dav/files/alice/`. */
	url: string;
	username: string;
	password: string;
	/** Relay prefix (`https://worker/dav/`), or `null` to call the server directly. */
	proxy: string | null;
}

/** One PROPFIND result. */
export interface DavEntry {
	/** Relative to the WebDAV address, decoded: `/Notes/a.org` (`''` for the address itself). */
	path: string;
	folder: boolean;
	etag: string;
}

/** Last listing, kept in the cursor to skip unchanged folders. */
interface Tree {
	/** Folder ETags change with their contents (Nextcloud, ownCloud). */
	trusted: boolean;
	/** The server answers `Depth: infinity` (`false`: it refused; don't ask again). */
	infinity?: boolean;
	folders: Record<string, { etag: string; files: { path: string; rev: string }[]; dirs: string[] }>;
}

const PROPFIND = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/></d:prop></d:propfind>`;

const unescapeXml = (s: string) =>
	s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&amp;/g, '&');

/** Parse a PROPFIND multistatus into paths relative to `basePath` (a decoded URL path). */
export function parseMultistatus(xml: string, basePath: string): DavEntry[] {
	const base = basePath.replace(/\/+$/, '');
	const tag = (name: string) =>
		`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`;
	const out: DavEntry[] = [];
	for (const m of xml.matchAll(new RegExp(tag('response'), 'g'))) {
		const block = m[1]!;
		const href = new RegExp(tag('href')).exec(block)?.[1];
		if (!href) continue;
		let path = unescapeXml(href.trim());
		try {
			path = decodeURIComponent(new URL(path, 'http://x').pathname);
		} catch {
			continue;
		}
		if (!path.startsWith(base)) continue;
		path = path.slice(base.length).replace(/\/+$/, '');
		const folder = /<(?:[\w-]+:)?collection\s*\/?>/.test(block);
		// A propstat for missing properties can repeat getetag empty: take the first with a value.
		let etag = '';
		for (const e of block.matchAll(new RegExp(tag('getetag'), 'g')))
			if (e[1]!.trim()) {
				etag = unescapeXml(e[1]!.trim());
				break;
			}
		out.push({ path, folder, etag });
	}
	return out;
}

/** Base64 of UTF-8 (passwords may hold any character). */
function basic(username: string, password: string): string {
	const bytes = new TextEncoder().encode(`${username}:${password}`);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return `Basic ${btoa(bin)}`;
}

/** Nextcloud and ownCloud: folder ETags change when anything inside changes. */
const trustsFolderEtags = (xml: string) => /owncloud\.org\/ns|nextcloud\.org\/ns/.test(xml);

export class WebDav implements RemoteFiles, RemoteBrowser {
	readonly base: URL;

	constructor(
		readonly config: WebDavConfig,
		private fetcher: typeof fetch = (...a) => fetch(...a),
	) {
		this.base = new URL(config.url.endsWith('/') ? config.url : `${config.url}/`);
	}

	/** The request URL for a vault path (through the relay when there is one). */
	url(path: string): string {
		const encoded = path
			.split('/')
			.filter(Boolean)
			.map((p) => encodeURIComponent(p))
			.join('/');
		const target = new URL(encoded, this.base);
		if (path.endsWith('/') && !target.pathname.endsWith('/')) target.pathname += '/';
		if (!this.config.proxy) return target.toString();
		return `${this.config.proxy.replace(/\/?$/, '/')}${target.host}${target.pathname}`;
	}

	async #call(method: string, path: string, headers: Record<string, string> = {}, body?: BodyInit) {
		const res = await this.fetcher(this.url(path), {
			method,
			headers: { Authorization: basic(this.config.username, this.config.password), ...headers },
			...(body !== undefined ? { body } : {}),
			...(typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(60_000) } : {}),
		});
		if (res.status === 401)
			throw new RemoteAuthError('The server refused the user name or password.');
		return res;
	}

	/** PROPFIND a folder (Depth 1) or one item (Depth 0). */
	async propfind(
		path: string,
		depth: 0 | 1 | 'infinity',
	): Promise<{ entries: DavEntry[]; xml: string }> {
		const res = await this.#call(
			'PROPFIND',
			depth === 0 ? path : `${path}/`,
			{ Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' },
			PROPFIND,
		);
		if (res.status === 404) throw new RemoteNotFound(path);
		if (res.status !== 207 && !res.ok) throw new RemoteError(res.status, res.statusText, 'WebDAV');
		const xml = await res.text();
		return { entries: parseMultistatus(xml, decodeURIComponent(this.base.pathname)), xml };
	}

	async #etag(path: string): Promise<string | null> {
		try {
			const { entries } = await this.propfind(path, 0);
			return entries[0]?.etag ?? null;
		} catch (e) {
			if (e instanceof RemoteNotFound) return null;
			throw e;
		}
	}

	/**
	 * The whole tree in one request, for servers that allow `Depth: infinity`
	 * (Nextcloud doesn't by default; Apache, nginx and others may). `null` when
	 * the server refuses, or answers only one level (some quietly do).
	 */
	async #infinity(root: string): Promise<RemoteEntry[] | null> {
		let found: DavEntry[];
		try {
			found = (await this.propfind(root, 'infinity')).entries;
		} catch (e) {
			if (e instanceof RemoteError && [400, 403, 405, 409, 412, 501, 507].includes(e.status))
				return null;
			throw e;
		}
		const depth = (p: string) => p.slice(root.length).split('/').filter(Boolean).length;
		const subfolders = found.filter((e) => e.folder && e.path !== root && depth(e.path) === 1);
		// A subfolder but nothing below the first level: probably only Depth 1 came back.
		if (subfolders.length && !found.some((e) => depth(e.path) >= 2)) return null;
		const hidden = (p: string) =>
			p
				.slice(root.length)
				.split('/')
				.some((part) => part.startsWith('.'));
		return found
			.filter((e) => !e.folder && e.path.startsWith(`${root}/`) && !hidden(e.path))
			.map((e) => ({ tag: 'file', path: e.path, pathLower: e.path, rev: e.etag }));
	}

	async #walk(root: string, before: Tree | null): Promise<{ entries: RemoteEntry[]; tree: Tree }> {
		// One request for the whole tree, where the server allows it (and it isn't
		// Nextcloud/ownCloud, whose folder ETags already make listing cheap).
		if (!before?.trusted && before?.infinity !== false) {
			const all = await this.#infinity(root);
			if (all) return { entries: all, tree: { trusted: false, infinity: true, folders: {} } };
			const walked = await this.#walkFolders(root, before);
			walked.tree.infinity = false;
			return walked;
		}
		return this.#walkFolders(root, before);
	}

	async #walkFolders(
		root: string,
		before: Tree | null,
	): Promise<{ entries: RemoteEntry[]; tree: Tree }> {
		const tree: Tree = {
			trusted: before?.trusted ?? false,
			...(before?.infinity === false ? { infinity: false } : {}),
			folders: {},
		};
		const entries: RemoteEntry[] = [];
		const file = (path: string, rev: string) =>
			entries.push({ tag: 'file', path, pathLower: path, rev });
		/** Reuse a folder unchanged since last time, with everything under it. */
		const reuse = (dir: string) => {
			const f = before!.folders[dir]!;
			tree.folders[dir] = f;
			for (const x of f.files) file(x.path, x.rev);
			for (const d of f.dirs) reuse(d);
		};
		let level = [root];
		let first = true;
		while (level.length) {
			const next: string[] = [];
			await pool(level, 4, async (dir) => {
				const { entries: found, xml } = await this.propfind(dir, 1);
				if (first) {
					tree.trusted = trustsFolderEtags(xml);
					first = false;
				}
				const self = found.find((e) => e.path === dir);
				const folder = {
					etag: self?.etag ?? '',
					files: [] as Tree['folders'][string]['files'],
					dirs: [] as string[],
				};
				tree.folders[dir] = folder;
				for (const e of found) {
					if (e.path === dir) continue;
					const name = e.path.split('/').pop()!;
					if (e.folder) {
						if (name.startsWith('.')) continue;
						folder.dirs.push(e.path);
						const known = before?.folders[e.path];
						if (tree.trusted && known && e.etag && known.etag === e.etag) reuse(e.path);
						else next.push(e.path);
					} else {
						folder.files.push({ path: e.path, rev: e.etag });
						file(e.path, e.etag);
					}
				}
			});
			level = next;
		}
		return { entries, tree };
	}

	async listAll(start: { path: string } | { cursor: string }): Promise<RemoteListing> {
		let root = 'path' in start ? start.path : '';
		let before: Tree | null = null;
		if ('cursor' in start) {
			try {
				const c = JSON.parse(start.cursor) as { root: string; tree: Tree };
				root = c.root;
				before = c.tree;
			} catch {
				/* start over */
			}
		}
		const { entries, tree } = await this.#walk(root, before);
		return { entries, cursor: JSON.stringify({ root, tree }), complete: true };
	}

	async download(path: string): Promise<{ text: string; rev: string }> {
		const res = await this.#call('GET', path);
		if (res.status === 404) throw new RemoteNotFound(path);
		if (!res.ok) throw new RemoteError(res.status, res.statusText, 'WebDAV');
		const text = await res.text();
		const rev = res.headers.get('ETag') ?? (await this.#etag(path)) ?? '';
		return { text, rev };
	}

	async #mkcols(path: string) {
		const parts = path.split('/').filter(Boolean).slice(0, -1);
		for (let i = 1; i <= parts.length; i += 1) {
			const res = await this.#call('MKCOL', `/${parts.slice(0, i).join('/')}/`);
			// 405: already there.
			if (!res.ok && res.status !== 405 && res.status !== 301)
				throw new RemoteError(res.status, res.statusText, 'WebDAV');
		}
	}

	async upload(path: string, text: string, rev: string | null): Promise<{ rev: string }> {
		const headers: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8' };
		if (rev && !rev.startsWith('W/')) headers['If-Match'] = rev;
		else if (rev) {
			// A weak ETag never satisfies If-Match: compare it just before writing instead.
			if ((await this.#etag(path)) !== rev) throw new RemoteConflict(path);
		} else headers['If-None-Match'] = '*';
		const body = new TextEncoder().encode(text);
		let res = await this.#call('PUT', path, headers, body);
		if (res.status === 409) {
			// The folder doesn't exist yet.
			await this.#mkcols(path);
			res = await this.#call('PUT', path, headers, body);
		}
		if (res.status === 412) throw new RemoteConflict(path);
		if (!res.ok) throw new RemoteError(res.status, res.statusText, 'WebDAV');
		const etag =
			res.headers.get('OC-ETag') ?? res.headers.get('ETag') ?? (await this.#etag(path)) ?? '';
		return { rev: etag };
	}

	async delete(path: string, rev: string | null): Promise<void> {
		const headers: Record<string, string> = {};
		if (rev && !rev.startsWith('W/')) headers['If-Match'] = rev;
		else if (rev) {
			const now = await this.#etag(path);
			if (now === null) return;
			if (now !== rev) throw new RemoteConflict(path);
		}
		const res = await this.#call('DELETE', path, headers);
		if (res.ok || res.status === 404) return;
		if (res.status === 412) throw new RemoteConflict(path);
		throw new RemoteError(res.status, res.statusText, 'WebDAV');
	}

	async browse(path: string) {
		const { entries } = await this.propfind(path, 1);
		const children = entries.filter((e) => e.path !== path);
		return {
			folders: children
				.filter((e) => e.folder && !e.path.split('/').pop()!.startsWith('.'))
				.map((e) => ({ name: e.path.split('/').pop()!, path: e.path }))
				.sort((a, b) => a.name.localeCompare(b.name)),
			orgFiles: children.filter((e) => !e.folder && /\.org$/i.test(e.path)).length,
		};
	}
}

/** Nextcloud's WebDAV address for a user, from the server's address. */
export function nextcloudUrl(server: string, username: string): string {
	const base = server.trim().replace(/\/+$/, '');
	if (/\/remote\.php\//.test(base)) return `${base}/`;
	return `${base}/remote.php/dav/files/${encodeURIComponent(username)}/`;
}
