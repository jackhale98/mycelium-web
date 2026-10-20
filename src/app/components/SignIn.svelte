<script lang="ts">
	import {
		availableProviders,
		beginSignIn,
		credentialsFrom,
		fetchAccount,
		fetchRepos,
		takeSignInResult,
		type Account,
		type OAuthProvider,
		type RemoteRepo,
		type TokenSet,
	} from '$lib/auth/oauth';
	import { PROVIDERS } from '$lib/git/providers';
	import { OAUTH_CONFIG, OAUTH_REDIRECT, WORKER_URL } from '../config';
	import { href, router } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	const providers = availableProviders(OAUTH_CONFIG);

	let session = $state<{ tokens: TokenSet; account: Account; repos: RemoteRepo[] } | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let filter = $state('');

	const shown = $derived(
		session?.repos.filter((r) => r.slug.toLowerCase().includes(filter.trim().toLowerCase())) ?? [],
	);

	// Back from the provider: load the account and its repositories.
	$effect(() => {
		const tokens = takeSignInResult();
		if (!tokens) return;
		busy = true;
		void Promise.all([
			fetchAccount(tokens.provider, tokens.accessToken),
			fetchRepos(tokens.provider, tokens.accessToken),
		])
			.then(([account, repos]) => (session = { tokens, account, repos }))
			.catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)))
			.finally(() => (busy = false));
	});

	async function signIn(provider: OAuthProvider) {
		error = null;
		try {
			await beginSignIn(provider, OAUTH_CONFIG, OAUTH_REDIRECT(), 'app#/vaults');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function open(repo: RemoteRepo) {
		if (!session) return;
		const ok = await app.connect({
			url: repo.cloneUrl,
			provider: session.tokens.provider,
			slug: repo.slug,
			branch: repo.defaultBranch,
			token: '',
			username: '',
			corsProxy: WORKER_URL || null,
			author: { name: session.account.name, email: session.account.email },
			credentials: credentialsFrom(session.tokens),
		});
		if (ok) router.go(href.home());
	}
</script>

{#if providers.length}
	<section class="panel stack" aria-labelledby="signin-h">
		{#if session}
			<div class="row between">
				<h2 id="signin-h">
					Choose a repository <span class="who"
						>{PROVIDERS[session.tokens.provider].name} · {session.account.login}</span
					>
				</h2>
				<button type="button" class="btn small" onclick={() => (session = null)}>Sign out</button>
			</div>
			{#if session.repos.length > 8}
				<input class="input" type="search" placeholder="Filter repositories" bind:value={filter} />
			{/if}
			{#if session.repos.length === 0}
				<p class="notice info">
					<Icon name="info" size={16} />
					<span
						>No repositories yet.
						{#if session.tokens.provider === 'github' && OAUTH_CONFIG.githubAppSlug}
							<a
								href={`https://github.com/apps/${OAUTH_CONFIG.githubAppSlug}/installations/new`}
								target="_blank"
								rel="noopener noreferrer">Install on repositories</a
							>, then sign in again.
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
				{#if session.tokens.provider === 'github' && OAUTH_CONFIG.githubAppSlug}
					<p class="hint">
						Missing one? <a
							href={`https://github.com/apps/${OAUTH_CONFIG.githubAppSlug}/installations/new`}
							target="_blank"
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
					<button type="button" class="btn" disabled={busy} onclick={() => signIn(p)}
						><Icon name="git" size={16} />Sign in with {PROVIDERS[p].name}</button
					>
				{/each}
			</div>
		{/if}
		{#if busy}<p class="hint" role="status">Loading your repositories…</p>{/if}
		{#if error}<p class="notice warn" role="alert">
				<Icon name="alert" size={16} /><span>{error}</span>
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
