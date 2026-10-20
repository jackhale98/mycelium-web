<script module lang="ts">
	import type { Account, RemoteRepo, TokenSet } from '$lib/auth/oauth';

	// Module-level, so the result of signing in survives the page being rebuilt
	// while the app starts up (it arrives straight after the redirect back).
	const s = $state<{
		session: { tokens: TokenSet; account: Account; repos: RemoteRepo[] } | null;
		busy: boolean;
		error: string | null;
	}>({ session: null, busy: false, error: null });
</script>

<script lang="ts">
	import {
		availableProviders,
		beginSignIn,
		credentialsFrom,
		fetchAccount,
		fetchRepos,
		takeSignInResult,
		type OAuthProvider,
	} from '$lib/auth/oauth';
	import { PROVIDERS } from '$lib/git/providers';
	import { OAUTH_CONFIG, OAUTH_REDIRECT, WORKER_URL } from '../config';
	import { href, router } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	const providers = availableProviders(OAUTH_CONFIG);

	let filter = $state('');

	const shown = $derived(
		s.session?.repos.filter((r) => r.slug.toLowerCase().includes(filter.trim().toLowerCase())) ??
			[],
	);

	// Back from the provider: load the account and its repositories.
	$effect(() => {
		const tokens = takeSignInResult();
		if (!tokens) return;
		s.busy = true;
		void Promise.all([
			fetchAccount(tokens.provider, tokens.accessToken),
			fetchRepos(tokens.provider, tokens.accessToken),
		])
			.then(([account, repos]) => (s.session = { tokens, account, repos }))
			.catch((e: unknown) => (s.error = e instanceof Error ? e.message : String(e)))
			.finally(() => (s.busy = false));
	});

	async function signIn(provider: OAuthProvider) {
		s.error = null;
		try {
			await beginSignIn(provider, OAUTH_CONFIG, OAUTH_REDIRECT(), 'app#/vaults');
		} catch (e) {
			s.error = e instanceof Error ? e.message : String(e);
		}
	}

	async function open(repo: RemoteRepo) {
		if (!s.session) return;
		const ok = await app.connect({
			url: repo.cloneUrl,
			provider: s.session.tokens.provider,
			slug: repo.slug,
			branch: repo.defaultBranch,
			token: '',
			username: '',
			corsProxy: WORKER_URL || null,
			author: { name: s.session.account.name, email: s.session.account.email },
			credentials: credentialsFrom(s.session.tokens),
		});
		if (ok) router.go(href.home());
	}
</script>

{#if providers.length}
	<section class="panel stack" aria-labelledby="signin-h">
		{#if s.session}
			<div class="row between">
				<h2 id="signin-h">
					Choose a repository <span class="who"
						>{PROVIDERS[s.session.tokens.provider].name} · {s.session.account.login}</span
					>
				</h2>
				<button type="button" class="btn small" onclick={() => (s.session = null)}>Sign out</button>
			</div>
			{#if s.session.repos.length > 8}
				<input class="input" type="search" placeholder="Filter repositories" bind:value={filter} />
			{/if}
			{#if s.session.repos.length === 0}
				<p class="notice info">
					<Icon name="info" size={16} />
					<span
						>No repositories yet.
						{#if s.session.tokens.provider === 'github' && OAUTH_CONFIG.githubAppSlug}
							<a
								href={`https://github.com/apps/${OAUTH_CONFIG.githubAppSlug}/installations/new`}
								rel="noopener noreferrer">Install on repositories</a
							> and pick your notes repository; you'll come straight back here.
						{:else if s.session.tokens.provider === 'github'}
							The GitHub App has to be installed on your notes repository first: open the app's page
							on GitHub (Settings → Developer settings → GitHub Apps → your app → Install App),
							choose the repository, then sign in again.
						{/if}</span
					>
				</p>
			{:else}
				<ul class="repos">
					{#each shown.slice(0, 100) as repo (repo.slug)}
						<li>
							<button
								type="button"
								onclick={() => open(repo)}
								disabled={!!app.loading || !!app.connecting}
							>
								<Icon name="git" size={15} />
								<span class="slug">{repo.slug}</span>
								{#if repo.private}<span class="lock">private</span>{/if}
								<span class="br">{repo.defaultBranch ?? ''}</span>
							</button>
						</li>
					{/each}
				</ul>
				{#if s.session.tokens.provider === 'github' && OAUTH_CONFIG.githubAppSlug}
					<p class="hint">
						Missing one? <a
							href={`https://github.com/apps/${OAUTH_CONFIG.githubAppSlug}/installations/new`}
							rel="noopener noreferrer">Install on repositories</a
						>.
					</p>
				{/if}
			{/if}
		{:else}
			<h2 id="signin-h">Sign in</h2>
			<p class="hint">
				Pick a repository from your account — no tokens to paste. Your sign-in stays in this
				browser.
			</p>
			<div class="row">
				{#each providers as p (p)}
					<button type="button" class="btn" disabled={s.busy} onclick={() => signIn(p)}
						><Icon name="git" size={16} />Sign in with {PROVIDERS[p].name}</button
					>
				{/each}
			</div>
		{/if}
		{#if s.busy}<p class="hint" role="status">Loading your repositories…</p>{/if}
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
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.86rem;
	}
	.hint a,
	.notice a {
		color: var(--link);
	}
	.repos {
		max-height: 22rem;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		list-style: none;
	}
	.repos li + li {
		border-top: 1px solid var(--border);
	}
	.repos button {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		padding: 0.6rem 0.8rem;
		border: 0;
		background: none;
		color: var(--text);
		font-size: 0.88rem;
		text-align: left;
	}
	.repos button:hover:not(:disabled) {
		background: var(--surface-2);
	}
	.slug {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-weight: 550;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lock {
		padding: 0 0.4rem;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-muted);
		font-size: 0.7rem;
	}
	.br {
		color: var(--text-faint);
		font-family: var(--font-mono);
		font-size: 0.72rem;
	}
</style>
