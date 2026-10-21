/// OneDrive and SharePoint document libraries through Microsoft Graph,
/// straight from the browser: Graph allows cross-origin calls, and sign-in
/// uses PKCE with no client secret (an Entra "single-page application").

import {
	CursorExpired,
	pool,
	RemoteAuthError,
	RemoteConflict,
	RemoteError,
	RemoteNotFound,
	type RemoteBlobs,
	type RemoteBrowser,
	type RemoteEntry,
	type RemoteFiles,
	type RemoteListing,
} from '$lib/sync/remote';

const GRAPH = 'https://graph.microsoft.com/v1.0';
export const MS_AUTHORIZE = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
export const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

/** Personal or work OneDrive. */
export const ONEDRIVE_SCOPES = 'offline_access User.Read Files.ReadWrite.All';
/** Adds finding SharePoint sites and their document libraries (work accounts). */
export const SHAREPOINT_SCOPES = `${ONEDRIVE_SCOPES} Sites.Read.All`;

interface Item {
	id: string;
	name?: string;
	eTag?: string;
	file?: object;
	folder?: object;
	root?: object;
	deleted?: object;
	parentReference?: { path?: string; id?: string };
	'@microsoft.graph.downloadUrl'?: string;
}

interface Page {
	value: Item[];
	'@odata.nextLink'?: string;
	'@odata.deltaLink'?: string;
}

/** The change cursor: Graph's delta link, the vault folder and its folders by id. */
interface Cursor {
	delta: string;
	root: string;
	/** Folder id → lower-cased path, to place deletions and spot renamed folders. */
	folders: Record<string, string>;
}

/** Encode a path for Graph's `root:/…:` addressing. */
export function graphPath(path: string): string {
	return path
		.split('/')
		.filter(Boolean)
		.map((p) => encodeURIComponent(p))
		.join('/');
}

/** `/drive/root:/Notes/daily` (or `/drives/{id}/root:`) → `/Notes/daily`. */
export function parentPath(ref: string | undefined): string | null {
	if (!ref) return null;
	const i = ref.indexOf('root:');
	if (i < 0) return null;
	return decodeURIComponent(ref.slice(i + 5));
}

export interface DriveChoice {
	id: string;
	name: string;
	/** e.g. "OneDrive" or the site's name. */
	owner: string;
}

export class GraphDrive implements RemoteFiles, RemoteBrowser, RemoteBlobs {
	constructor(
		readonly driveId: string,
		private token: (force?: boolean) => Promise<string>,
		private fetcher: typeof fetch = (...a) => fetch(...a),
	) {}

	/** `/drives/{id}/root` or `/drives/{id}/root:/a/b:` for a path. */
	#item(path: string, suffix = ''): string {
		const p = graphPath(path);
		const base = `${GRAPH}/drives/${encodeURIComponent(this.driveId)}/root`;
		if (!p) return `${base}${suffix ? `/${suffix}` : ''}`;
		return `${base}:/${p}:${suffix ? `/${suffix}` : ''}`;
	}

	async #call(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
		const res = await this.fetcher(url, {
			...(typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(60_000) } : {}),
			...init,
			headers: {
				...(init.headers as Record<string, string>),
				Authorization: `Bearer ${await this.token(retried)}`,
			},
		});
		if (res.status === 401 && !retried) return this.#call(url, init, true);
		if (res.status === 401) throw new RemoteAuthError('OneDrive signed you out.');
		return res;
	}

	async #json<T>(url: string): Promise<T> {
		const res = await this.#call(url);
		if (res.status === 404) throw new RemoteNotFound(url);
		if (res.status === 410) throw new CursorExpired();
		if (!res.ok) throw await failure(res);
		return (await res.json()) as T;
	}

	/** Every page of a collection. */
	async #all(url: string): Promise<{ items: Item[]; deltaLink?: string }> {
		const items: Item[] = [];
		let next: string | undefined = url;
		let deltaLink: string | undefined;
		while (next) {
			const page: Page = await this.#json<Page>(next);
			items.push(...page.value);
			next = page['@odata.nextLink'];
			deltaLink = page['@odata.deltaLink'] ?? deltaLink;
		}
		return deltaLink ? { items, deltaLink } : { items };
	}

	#children(path: string) {
		return this.#all(`${this.#item(path, 'children')}?$top=999&$select=id,name,eTag,file,folder`);
	}

	/** Walk a folder: its files and its folders (by id), recursively. */
	async #walk(root: string, folders: Record<string, string>): Promise<RemoteEntry[]> {
		const files: RemoteEntry[] = [];
		let level = [root];
		while (level.length) {
			const next: string[] = [];
			await pool(level, 4, async (dir) => {
				const { items } = await this.#children(dir);
				for (const it of items) {
					const path = `${dir}/${it.name}`;
					if (it.folder) {
						if (it.name!.startsWith('.')) continue;
						folders[it.id] = path.toLowerCase();
						next.push(path);
					} else if (it.file)
						files.push({ tag: 'file', path, pathLower: path.toLowerCase(), rev: it.eTag ?? '' });
				}
			});
			level = next;
		}
		return files;
	}

	async #latest(): Promise<string> {
		const page = await this.#json<Page>(`${this.#item('', 'delta')}?token=latest`);
		if (!page['@odata.deltaLink']) throw new RemoteError(500, 'No delta link', 'OneDrive');
		return page['@odata.deltaLink'];
	}

	async #full(root: string): Promise<RemoteListing> {
		// Take the change position first, so nothing that changes during the walk is missed.
		const delta = await this.#latest();
		const folders: Record<string, string> = {};
		const entries = await this.#walk(root, folders);
		return {
			entries,
			cursor: JSON.stringify({ delta, root, folders } satisfies Cursor),
			complete: true,
		};
	}

	async listAll(start: { path: string } | { cursor: string }): Promise<RemoteListing> {
		if ('path' in start) return this.#full(start.path);
		let cursor: Cursor;
		try {
			cursor = JSON.parse(start.cursor) as Cursor;
		} catch {
			throw new CursorExpired();
		}
		const rootLower = cursor.root.toLowerCase();
		const inside = (p: string) => !rootLower || p.startsWith(`${rootLower}/`);
		const { items, deltaLink } = await this.#all(cursor.delta);
		const folders = { ...cursor.folders };
		const entries: RemoteEntry[] = [];
		const newFolders: string[] = [];
		for (const it of items) {
			if (it.root) continue;
			const parent = parentPath(it.parentReference?.path);
			const path = parent !== null && it.name ? `${parent}/${it.name}` : null;
			if (it.deleted) {
				const known = folders[it.id];
				if (known) {
					delete folders[it.id];
					entries.push({ tag: 'deleted', path: known, pathLower: known });
				} else if (path) {
					if (inside(path.toLowerCase()))
						entries.push({ tag: 'deleted', path, pathLower: path.toLowerCase() });
				}
				// Work drives often leave out where a deleted item was: list everything.
				else return this.#full(cursor.root);
				continue;
			}
			if (!path) continue;
			const lower = path.toLowerCase();
			if (it.folder) {
				const before = folders[it.id];
				// A folder that moved or was renamed: its files' paths changed without being reported.
				if (before && before !== lower) return this.#full(cursor.root);
				if (!before && inside(lower) && !it.name!.startsWith('.')) {
					folders[it.id] = lower;
					newFolders.push(path);
				}
				continue;
			}
			if (it.file && inside(lower))
				entries.push({ tag: 'file', path, pathLower: lower, rev: it.eTag ?? '' });
		}
		// A new folder (or one moved in) may arrive with its files unlisted.
		for (const dir of newFolders) entries.push(...(await this.#walk(dir, folders)));
		return {
			entries,
			cursor: JSON.stringify({
				delta: deltaLink ?? cursor.delta,
				root: cursor.root,
				folders,
			} satisfies Cursor),
		};
	}

	async download(path: string): Promise<{ text: string; rev: string }> {
		const item = await this.#json<Item>(this.#item(path));
		const url = item['@microsoft.graph.downloadUrl'];
		if (!url) throw new RemoteNotFound(path);
		// A short-lived, pre-signed link: no Authorization header (and none allowed).
		const res = await this.fetcher(url);
		if (!res.ok) throw await failure(res);
		return { text: await res.text(), rev: item.eTag ?? '' };
	}

	async upload(path: string, text: string, rev: string | null): Promise<{ rev: string }> {
		const url = rev
			? this.#item(path, 'content')
			: `${this.#item(path, 'content')}?@microsoft.graph.conflictBehavior=fail`;
		const res = await this.#call(url, {
			method: 'PUT',
			headers: { 'Content-Type': 'text/plain', ...(rev ? { 'If-Match': rev } : {}) },
			body: new TextEncoder().encode(text),
		});
		if (res.status === 412 || res.status === 409) throw new RemoteConflict(path);
		if (!res.ok) throw await failure(res);
		const item = (await res.json()) as Item;
		return { rev: item.eTag ?? '' };
	}

	async delete(path: string, rev: string | null): Promise<void> {
		const res = await this.#call(this.#item(path), {
			method: 'DELETE',
			headers: rev ? { 'If-Match': rev } : {},
		});
		if (res.ok || res.status === 404) return;
		if (res.status === 412) throw new RemoteConflict(path);
		throw await failure(res);
	}

	async downloadBytes(path: string): Promise<Uint8Array> {
		const item = await this.#json<Item>(this.#item(path));
		const url = item['@microsoft.graph.downloadUrl'];
		if (!url) throw new RemoteNotFound(path);
		const res = await this.fetcher(url);
		if (!res.ok) throw await failure(res);
		return new Uint8Array(await res.arrayBuffer());
	}

	/** Simple upload (Graph takes up to 250 MB this way). */
	async uploadBytes(path: string, bytes: Uint8Array): Promise<void> {
		const res = await this.#call(
			`${this.#item(path, 'content')}?@microsoft.graph.conflictBehavior=fail`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: bytes as unknown as BodyInit,
			},
		);
		if (res.status === 409 || res.status === 412) throw new RemoteConflict(path);
		if (!res.ok) throw await failure(res);
	}

	async browse(path: string) {
		const { items } = await this.#children(path);
		return {
			folders: items
				.filter((i) => i.folder && !i.name!.startsWith('.'))
				.map((i) => ({ name: i.name!, path: `${path}/${i.name}` }))
				.sort((a, b) => a.name.localeCompare(b.name)),
			orgFiles: items.filter((i) => i.file && /\.org$/i.test(i.name ?? '')).length,
		};
	}
}

async function failure(res: Response): Promise<RemoteError> {
	let summary = '';
	try {
		const body = (await res.json()) as { error?: { message?: string; code?: string } };
		summary = body.error?.message ?? body.error?.code ?? '';
	} catch {
		/* not JSON */
	}
	return new RemoteError(res.status, summary, 'OneDrive');
}

// ------------------------------------------------------------------ account and drives

/** Calls Graph outside a drive (account, drives, sites). */
export class GraphAccount {
	constructor(
		private accessToken: string,
		private fetcher: typeof fetch = (...a) => fetch(...a),
	) {}

	async #json<T>(path: string): Promise<T> {
		const res = await this.fetcher(`${GRAPH}${path}`, {
			headers: { Authorization: `Bearer ${this.accessToken}` },
		});
		if (res.status === 401) throw new RemoteAuthError('OneDrive signed you out.');
		if (!res.ok) throw await failure(res);
		return (await res.json()) as T;
	}

	async me(): Promise<{ name: string; email: string }> {
		const u = await this.#json<{ displayName?: string; mail?: string; userPrincipalName?: string }>(
			'/me?$select=displayName,mail,userPrincipalName',
		);
		return { name: u.displayName ?? '', email: u.mail ?? u.userPrincipalName ?? '' };
	}

	/** The signed-in person's own OneDrive. */
	async myDrive(): Promise<DriveChoice> {
		const d = await this.#json<{ id: string; driveType?: string }>(
			'/me/drive?$select=id,driveType',
		);
		return {
			id: d.id,
			name: d.driveType === 'personal' ? 'OneDrive' : 'OneDrive for work',
			owner: 'OneDrive',
		};
	}

	/** SharePoint sites matching `query` (work accounts; needs Sites.Read.All). */
	async searchSites(query: string): Promise<{ id: string; name: string; url: string }[]> {
		const r = await this.#json<{
			value: { id: string; displayName?: string; name?: string; webUrl: string }[];
		}>(
			`/sites?search=${encodeURIComponent(query.trim() || '*')}&$select=id,displayName,name,webUrl`,
		);
		return r.value.map((s) => ({
			id: s.id,
			name: s.displayName ?? s.name ?? s.webUrl,
			url: s.webUrl,
		}));
	}

	/** A site's document libraries. */
	async siteDrives(site: { id: string; name: string }): Promise<DriveChoice[]> {
		const r = await this.#json<{ value: { id: string; name: string; driveType?: string }[] }>(
			`/sites/${encodeURIComponent(site.id)}/drives?$select=id,name,driveType`,
		);
		return r.value
			.filter((d) => d.driveType === 'documentLibrary' || !d.driveType)
			.map((d) => ({ id: d.id, name: d.name, owner: site.name }));
	}
}

// ------------------------------------------------------------------ sign-in

export interface MicrosoftTokens {
	accessToken: string;
	refreshToken: string | null;
	expiresAt: number | null;
}

type TokenBody = {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	error?: string;
	error_description?: string;
};

function tokens(body: TokenBody, now: number, keepRefresh: string | null = null): MicrosoftTokens {
	if (!body.access_token)
		throw new Error(
			// Microsoft's descriptions start with a code like "AADSTS50011:"; keep the readable part.
			(body.error_description ?? body.error ?? 'Microsoft sign-in failed').split(/\r?\n/)[0]!,
		);
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token ?? keepRefresh,
		expiresAt: body.expires_in ? now + body.expires_in * 1000 : null,
	};
}

export function microsoftAuthorizeUrl(
	clientId: string,
	redirectUri: string,
	state: string,
	challenge: string,
	scopes: string,
): string {
	const url = new URL(MS_AUTHORIZE);
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('response_mode', 'query');
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('scope', scopes);
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge', challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('prompt', 'select_account');
	return url.toString();
}

async function tokenRequest(
	form: Record<string, string>,
	fetcher: typeof fetch,
): Promise<TokenBody> {
	const res = await fetcher(MS_TOKEN, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(form).toString(),
	});
	try {
		return (await res.json()) as TokenBody;
	} catch {
		return { error: `HTTP ${res.status}` };
	}
}

export async function exchangeMicrosoftCode(
	input: { clientId: string; code: string; verifier: string; redirectUri: string; scopes: string },
	fetcher: typeof fetch = (...a) => fetch(...a),
	now = Date.now(),
): Promise<MicrosoftTokens> {
	return tokens(
		await tokenRequest(
			{
				grant_type: 'authorization_code',
				client_id: input.clientId,
				code: input.code,
				code_verifier: input.verifier,
				redirect_uri: input.redirectUri,
				scope: input.scopes,
			},
			fetcher,
		),
		now,
	);
}

/** Microsoft rotates refresh tokens: keep the new one. */
export async function refreshMicrosoftToken(
	clientId: string,
	refreshToken: string,
	fetcher: typeof fetch = (...a) => fetch(...a),
	now = Date.now(),
): Promise<MicrosoftTokens> {
	return tokens(
		await tokenRequest(
			{ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken },
			fetcher,
		),
		now,
		refreshToken,
	);
}
