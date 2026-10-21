<script module lang="ts">
	import type { DropboxEntry, DropboxTokens } from '$lib/dropbox/api';

	/** Set before signing in again for an existing vault, so the new tokens go to it. */
	export const RENEW_KEY = 'mycelium:dropbox-renew';

	// Module-level, like SignIn: the result of signing in arrives straight after the
	// redirect back, and must survive the page being rebuilt while the app starts.
	const s = $state<{
		session: { tokens: DropboxTokens; account: string } | null;
		path: string;
		folders: DropboxEntry[];
		orgFiles: number;
		busy: boolean;
		error: string | null;
	}>({ session: null, path: '', folders: [], orgFiles: 0, busy: false, error: null });
</script>

<script lang="ts">
	import { beginDropboxSignIn, takeDropboxResult } from '$lib/auth/oauth';
	import { DropboxApi } from '$lib/dropbox/api';
	import { OAUTH_CONFIG, OAUTH_REDIRECT } from '../config';
	import { href, router } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	const api = () => new DropboxApi(async () => s.session!.tokens.accessToken);
	const crumbs = $derived.by(() => {
		const parts = s.path.split('/').filter(Boolean);
		return parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join('/')}` }));
	});

	// Back from Dropbox: renew a vault's sign-in, or browse for a folder.
	$effect(() => {
		const tokens = takeDropboxResult();
		if (!tokens) return;
		let renew: string | null = null;
		try {
			renew = sessionStorage.getItem(RENEW_KEY);
			sessionStorage.removeItem(RENEW_KEY);
		} catch {
			/* storage unavailable */
		}
		if (renew) {
			void app.renewDropbox(renew, tokens);
			return;
		}
		s.session = { tokens, account: '' };
		s.busy = true;
		void api()
			.account()
			.then((a) => s.session && (s.session.account = a.email || a.name))
			.catch(() => undefined);
		void browse('');
	});

	async function browse(path: string) {
		s.busy = true;
		s.error = null;
		try {
			const page = await api().list(path, false);
			s.path = path;
			s.folders = page.entries
				.filter((e) => e.tag === 'folder' && !e.path.split('/').pop()!.startsWith('.'))
				.sort((a, b) => a.path.localeCompare(b.path));
			s.orgFiles = page.entries.filter((e) => e.tag === 'file' && /\.org$/i.test(e.path)).length;
		} catch (e) {
			s.error = e instanceof Error ? e.message : String(e);
		} finally {
			s.busy = false;
		}
	}

	async function signIn() {
		s.error = null;
		try {
			await beginDropboxSignIn(OAUTH_CONFIG, OAUTH_REDIRECT(), 'app#/vaults');
		} catch (e) {
			s.error = e instanceof Error ? e.message : String(e);
		}
	}

	async function use() {
		if (!s.session) return;
		const ok = await app.connectDropbox(s.session.tokens, s.path, s.session.account);
		if (ok) {
			s.session = null;
			router.go(href.home());
		}
	}
</script>

{#if OAUTH_CONFIG.dropboxAppKey}
	<section class="panel stack" aria-labelledby="dropbox-h">
		{#if s.session}
			<div class="row between">
				<h2 id="dropbox-h">
					Choose your notes folder{#if s.session.account}<span class="who"
							>Dropbox · {s.session.account}</span
						>{/if}
				</h2>
				<button type="button" class="btn small" onclick={() => (s.session = null)}>Cancel</button>
			</div>
			<nav class="crumbs" aria-label="Folder">
				<button type="button" onclick={() => browse('')} aria-current={s.path ? undefined : 'page'}
					>Dropbox</button
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
			<ul class="folders" aria-busy={s.busy}>
				{#each s.folders as f (f.pathLower)}
					<li>
						<button type="button" disabled={s.busy} onclick={() => browse(f.path)}
							><Icon name="folder" size={15} /><span class="name">{f.path.split('/').pop()}</span
							><Icon name="chevronRight" size={14} /></button
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
				<button
					type="button"
					class="btn primary"
					disabled={s.busy || !!app.connecting}
					onclick={use}
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
		{:else}
			<h2 id="dropbox-h">Dropbox</h2>
			<p class="hint">
				Keep your org-roam folder in Dropbox and edit it here, on your phone, and in Emacs. Changes
				sync on their own, and edits on two devices are merged. Your sign-in stays in this browser
				and talks only to Dropbox.
			</p>
			<div class="row">
				<button type="button" class="btn" disabled={s.busy} onclick={signIn}
					><Icon name="cloud" size={16} />Connect Dropbox</button
				>
			</div>
		{/if}
		{#if s.error}<p class="notice warn" role="alert">
				<Icon name="alert" size={16} /><span>{s.error}</span>
			</p>{/if}
	</section>
{/if}

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
	.folders {
		max-height: 20rem;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		list-style: none;
	}
	.folders li + li {
		border-top: 1px solid var(--border);
	}
	.folders button {
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
	.folders button:hover:not(:disabled) {
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
