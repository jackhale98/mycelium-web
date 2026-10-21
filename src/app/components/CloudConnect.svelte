<script module lang="ts">
	import type { CloudState } from '$lib/store/db';
	import type { CloudClient } from '$lib/sync/services';
	import type { DriveChoice } from '$lib/onedrive/api';

	type Step =
		| { kind: 'start' }
		| { kind: 'webdav' }
		| {
				kind: 'drives';
				token: string;
				sharepoint: boolean;
				base: Partial<CloudState>;
				mine: DriveChoice | null;
				sites: { id: string; name: string; url: string }[];
				libraries: DriveChoice[];
				site: string | null;
		  }
		| {
				kind: 'folder';
				client: CloudClient;
				/** Everything for the vault except the folder. */
				base: Omit<CloudState, 'root' | 'cursor' | 'pending'>;
				/** Where the folder tree starts, for the breadcrumb. */
				top: string;
		  };

	// Module-level, like SignIn: a sign-in result arrives straight after the redirect
	// back, and must survive the page being rebuilt while the app starts.
	const s = $state<{
		step: Step;
		path: string;
		folders: { name: string; path: string }[];
		orgFiles: number;
		busy: boolean;
		error: string | null;
	}>({ step: { kind: 'start' }, path: '', folders: [], orgFiles: 0, busy: false, error: null });
</script>

<script lang="ts">
	import { beginCloudSignIn, takeCloudResult, type CloudSignIn } from '$lib/auth/oauth';
	import { CLOUD_CONFIG, OAUTH_CONFIG, OAUTH_REDIRECT } from '../config';
	import { href, router } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	const hasDropbox = !!CLOUD_CONFIG.dropboxAppKey;
	const hasOneDrive = !!CLOUD_CONFIG.onedriveClientId;

	let davServer = $state('');
	let davUser = $state('');
	let davPassword = $state('');
	let davRelay = $state(!!CLOUD_CONFIG.davProxy);

	const crumbs = $derived.by(() => {
		if (s.step.kind !== 'folder') return [];
		const parts = s.path.split('/').filter(Boolean);
		return parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join('/')}` }));
	});

	const fail = (e: unknown) => {
		s.error = e instanceof Error ? e.message : String(e);
		s.busy = false;
	};

	// Back from Dropbox or Microsoft: reconnect a vault, or go on to choose a folder.
	$effect(() => {
		const result = takeCloudResult();
		if (!result) return;
		const tokens = {
			accessToken: result.tokens.accessToken,
			refreshToken: result.tokens.refreshToken,
			expiresAt: result.tokens.expiresAt,
		};
		if (result.renew) {
			void app.reconnectCloud(result.renew, tokens);
			return;
		}
		s.error = null;
		s.busy = true;
		void (async () => {
			try {
				if (result.service === 'dropbox') {
					const { DropboxApi } = await import('$lib/dropbox/api');
					const client = new DropboxApi(async () => tokens.accessToken);
					const who = await client.account().catch(() => ({ email: '', name: '' }));
					s.step = {
						kind: 'folder',
						client,
						base: { service: 'dropbox', account: who.email || who.name, ...tokens },
						top: 'Dropbox',
					};
					await browse('');
				} else {
					const { GraphAccount } = await import('$lib/onedrive/api');
					const account = new GraphAccount(tokens.accessToken);
					const [who, mine] = await Promise.all([
						account.me().catch(() => ({ email: '', name: '' })),
						account.myDrive().catch(() => null),
					]);
					s.step = {
						kind: 'drives',
						token: tokens.accessToken,
						sharepoint: result.sharepoint,
						base: {
							service: 'onedrive',
							account: who.email || who.name,
							sharepoint: result.sharepoint,
							...tokens,
						},
						mine,
						sites: [],
						libraries: [],
						site: null,
					};
					s.busy = false;
					if (result.sharepoint) await searchSites('');
				}
			} catch (e) {
				fail(e);
			}
		})();
	});

	async function browse(path: string) {
		if (s.step.kind !== 'folder') return;
		s.busy = true;
		s.error = null;
		try {
			const r = await s.step.client.browse(path);
			s.path = path;
			s.folders = r.folders;
			s.orgFiles = r.orgFiles;
		} catch (e) {
			fail(e);
		} finally {
			s.busy = false;
		}
	}

	async function signIn(service: CloudSignIn, sharepoint = false) {
		s.error = null;
		try {
			await beginCloudSignIn(service, OAUTH_CONFIG, OAUTH_REDIRECT(), 'app#/vaults', {
				sharepoint,
			});
		} catch (e) {
			fail(e);
		}
	}

	let siteQuery = $state('');

	async function searchSites(query: string) {
		if (s.step.kind !== 'drives') return;
		s.busy = true;
		s.error = null;
		try {
			const { GraphAccount } = await import('$lib/onedrive/api');
			s.step.sites = await new GraphAccount(s.step.token).searchSites(query);
			s.step.libraries = [];
			s.step.site = null;
		} catch (e) {
			fail(e);
		} finally {
			s.busy = false;
		}
	}

	async function openSite(site: { id: string; name: string }) {
		if (s.step.kind !== 'drives') return;
		s.busy = true;
		try {
			const { GraphAccount } = await import('$lib/onedrive/api');
			s.step.libraries = await new GraphAccount(s.step.token).siteDrives(site);
			s.step.site = site.name;
		} catch (e) {
			fail(e);
		} finally {
			s.busy = false;
		}
	}

	async function chooseDrive(drive: DriveChoice) {
		if (s.step.kind !== 'drives') return;
		const step = s.step;
		const { GraphDrive } = await import('$lib/onedrive/api');
		const driveName =
			drive.owner === 'OneDrive' ? drive.name : `SharePoint · ${drive.owner} › ${drive.name}`;
		s.step = {
			kind: 'folder',
			client: new GraphDrive(drive.id, async () => step.token),
			base: {
				...(step.base as Omit<CloudState, 'root' | 'cursor' | 'pending'>),
				driveId: drive.id,
				driveName,
			},
			top: drive.owner === 'OneDrive' ? drive.name : drive.name,
		};
		await browse('');
	}

	async function connectDav(e: SubmitEvent) {
		e.preventDefault();
		s.error = null;
		s.busy = true;
		try {
			const { nextcloudUrl, WebDav } = await import('$lib/webdav/api');
			const server = davServer.trim();
			if (!/^https:\/\//i.test(server)) throw new Error('Enter an https:// address.');
			// A bare server address is taken to be Nextcloud (or ownCloud); a path is used as it is.
			const url = new URL(server).pathname.replace(/\/+$/, '')
				? server
				: nextcloudUrl(server, davUser.trim());
			const config = {
				url,
				username: davUser.trim(),
				password: davPassword,
				proxy: davRelay ? CLOUD_CONFIG.davProxy : null,
			};
			const client = new WebDav(config);
			await client.browse('');
			s.step = {
				kind: 'folder',
				client,
				base: {
					service: 'webdav',
					account: `${config.username}@${new URL(url).host}`,
					...config,
				},
				top: new URL(url).host,
			};
			await browse('');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			fail(
				/Failed to fetch|NetworkError|Load failed/.test(msg)
					? davRelay
						? "Couldn't reach the server through the sync relay. Check the address."
						: "Couldn't reach the server. It probably doesn't allow requests from this site: turn on the sync relay."
					: msg,
			);
		}
	}

	async function use() {
		if (s.step.kind !== 'folder') return;
		const ok = await app.connectCloud({ ...s.step.base, root: s.path });
		if (ok) {
			s.step = { kind: 'start' };
			davPassword = '';
			router.go(href.home());
		}
	}

	const cancel = () => {
		s.step = { kind: 'start' };
		s.error = null;
	};
</script>

<section class="panel stack" aria-labelledby="cloud-h">
	{#if s.step.kind === 'folder'}
		<div class="row between">
			<h2 id="cloud-h">
				Choose your notes folder{#if s.step.base.account}<span class="who"
						>{s.step.base.account}</span
					>{/if}
			</h2>
			<button type="button" class="btn small" onclick={cancel}>Cancel</button>
		</div>
		<nav class="crumbs" aria-label="Folder">
			<button type="button" onclick={() => browse('')} aria-current={s.path ? undefined : 'page'}
				>{s.step.top}</button
			>
			{#each crumbs as c (c.path)}
				<Icon name="chevronRight" size={12} />
				<button
					type="button"
					onclick={() => browse(c.path)}
					aria-current={c.path === s.path ? 'page' : undefined}>{c.name}</button
				>
			{/each}
		</nav>
		<ul class="list" aria-busy={s.busy}>
			{#each s.folders as f (f.path)}
				<li>
					<button type="button" disabled={s.busy} onclick={() => browse(f.path)}
						><Icon name="folder" size={15} /><span class="name">{f.name}</span><Icon
							name="chevronRight"
							size={14}
						/></button
					>
				</li>
			{:else}
				<li class="empty">{s.busy ? 'Loading…' : 'No folders here'}</li>
			{/each}
		</ul>
		<div class="row between">
			<p class="hint">
				{s.orgFiles
					? `${s.orgFiles} org ${s.orgFiles === 1 ? 'file' : 'files'} here (subfolders count too)`
					: 'Subfolders like daily/ are included.'}
			</p>
			<button type="button" class="btn primary" disabled={s.busy || !!app.connecting} onclick={use}
				><Icon name="check" size={16} />Use {crumbs.at(-1)?.name ?? 'this folder'}</button
			>
		</div>
		{#if app.connecting}
			<p class="hint" role="status">
				{app.connecting.phase}{app.connecting.ratio !== null
					? ` · ${Math.round(app.connecting.ratio * 100)}%`
					: '…'}
			</p>
		{/if}
	{:else if s.step.kind === 'drives'}
		<div class="row between">
			<h2 id="cloud-h">
				Where are your notes?{#if s.step.base.account}<span class="who">{s.step.base.account}</span
					>{/if}
			</h2>
			<button type="button" class="btn small" onclick={cancel}>Cancel</button>
		</div>
		{#if s.step.mine}
			{@const mine = s.step.mine}
			<ul class="list">
				<li>
					<button type="button" onclick={() => chooseDrive(mine)}
						><Icon name="cloud" size={15} /><span class="name">My files · {mine.name}</span><Icon
							name="chevronRight"
							size={14}
						/></button
					>
				</li>
			</ul>
		{/if}
		{#if s.step.sharepoint}
			<form
				class="row"
				onsubmit={(e) => {
					e.preventDefault();
					void searchSites(siteQuery);
				}}
			>
				<input
					class="input grow"
					type="search"
					placeholder="Find a SharePoint site"
					aria-label="Find a SharePoint site"
					bind:value={siteQuery}
				/>
				<button class="btn" disabled={s.busy}>Search</button>
			</form>
			{#if s.step.site}
				<p class="hint">Document libraries in {s.step.site}</p>
				<ul class="list">
					{#each s.step.libraries as lib (lib.id)}
						<li>
							<button type="button" onclick={() => chooseDrive(lib)}
								><Icon name="folder" size={15} /><span class="name">{lib.name}</span><Icon
									name="chevronRight"
									size={14}
								/></button
							>
						</li>
					{:else}
						<li class="empty">No document libraries you can open</li>
					{/each}
				</ul>
			{:else}
				<ul class="list" aria-busy={s.busy}>
					{#each s.step.sites as site (site.id)}
						<li>
							<button type="button" disabled={s.busy} onclick={() => openSite(site)}
								><Icon name="link" size={15} /><span class="name">{site.name}</span><Icon
									name="chevronRight"
									size={14}
								/></button
							>
						</li>
					{:else}
						<li class="empty">{s.busy ? 'Loading…' : 'No sites found'}</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{:else if s.step.kind === 'webdav'}
		<div class="row between">
			<h2 id="cloud-h">WebDAV server</h2>
			<button type="button" class="btn small" onclick={cancel}>Cancel</button>
		</div>
		<form class="stack" onsubmit={connectDav}>
			<div class="field">
				<label for="dav-url">Server address</label>
				<input
					id="dav-url"
					class="input"
					type="url"
					required
					placeholder="https://cloud.example.com"
					autocapitalize="off"
					spellcheck="false"
					bind:value={davServer}
				/>
				<p class="hint">
					For Nextcloud or ownCloud, the server's address is enough. Otherwise paste the full WebDAV
					address.
				</p>
			</div>
			<div class="row two">
				<div class="field">
					<label for="dav-user">User name</label>
					<input
						id="dav-user"
						class="input"
						required
						autocapitalize="off"
						autocomplete="username"
						bind:value={davUser}
					/>
				</div>
				<div class="field">
					<label for="dav-pass">App password</label>
					<input
						id="dav-pass"
						class="input"
						type="password"
						required
						autocomplete="current-password"
						bind:value={davPassword}
					/>
				</div>
			</div>
			<p class="hint">
				Use an app password (Nextcloud: Settings → Security → Devices &amp; sessions), not your main
				one. It's kept only in this browser.
			</p>
			{#if CLOUD_CONFIG.davProxy}
				<label class="check"
					><input type="checkbox" bind:checked={davRelay} />
					<span
						>Use the sync relay. Most servers don't accept requests from other websites; the relay
						passes them on without storing anything. Turn it off if your server allows this site
						(CORS).</span
					></label
				>
			{/if}
			<div class="row">
				<button class="btn primary" disabled={s.busy}
					><Icon name="check" size={16} />{s.busy ? 'Connecting…' : 'Connect'}</button
				>
			</div>
		</form>
	{:else}
		<h2 id="cloud-h">Cloud storage</h2>
		<p class="hint">
			Keep your org-roam folder in Dropbox, OneDrive, SharePoint or on a WebDAV server such as
			Nextcloud, and edit it here, on your phone, and in Emacs. Changes sync on their own, edits on
			two devices are merged, and it works offline.
		</p>
		<div class="row">
			{#if hasDropbox}
				<button type="button" class="btn" disabled={s.busy} onclick={() => signIn('dropbox')}
					><Icon name="cloud" size={16} />Connect Dropbox</button
				>
			{/if}
			{#if hasOneDrive}
				<button type="button" class="btn" disabled={s.busy} onclick={() => signIn('onedrive')}
					><Icon name="cloud" size={16} />Connect OneDrive</button
				>
				<button type="button" class="btn" disabled={s.busy} onclick={() => signIn('onedrive', true)}
					><Icon name="cloud" size={16} />Connect SharePoint</button
				>
			{/if}
			<button type="button" class="btn" onclick={() => (s.step = { kind: 'webdav' })}
				><Icon name="cloud" size={16} />Connect WebDAV / Nextcloud</button
			>
		</div>
		{#if hasOneDrive}
			<p class="hint">
				SharePoint is for work and school accounts; it also asks to find your organisation's sites.
			</p>
		{/if}
	{/if}
	{#if s.error}<p class="notice warn" role="alert">
			<Icon name="alert" size={16} /><span>{s.error}</span>
		</p>{/if}
</section>

<style>
	.who {
		margin-left: 0.4rem;
		color: var(--text-muted);
		font-size: 0.8rem;
		font-weight: 500;
	}
	.between {
		justify-content: space-between;
		align-items: center;
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.86rem;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.check {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		color: var(--text-muted);
		font-size: 0.86rem;
	}
	.check input {
		accent-color: var(--accent);
	}
	.crumbs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.15rem;
		color: var(--text-faint);
		font-size: 0.85rem;
	}
	.crumbs button {
		padding: 0.2rem 0.35rem;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--link);
		font-size: inherit;
	}
	.crumbs button[aria-current='page'] {
		color: var(--text);
		font-weight: 650;
	}
	.list {
		max-height: 20rem;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		list-style: none;
	}
	.list li + li {
		border-top: 1px solid var(--border);
	}
	.list button {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		min-height: 2.75rem;
		padding: 0.55rem 0.8rem;
		border: 0;
		background: none;
		color: var(--text);
		font-size: 0.9rem;
		text-align: left;
	}
	.list button:hover:not(:disabled) {
		background: var(--surface-2);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.empty {
		padding: 0.7rem 0.8rem;
		color: var(--text-muted);
		font-size: 0.86rem;
	}
</style>
