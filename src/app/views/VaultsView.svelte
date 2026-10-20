<script lang="ts">
	import { parseRepo, PROVIDERS, type ProviderId } from '$lib/git/providers';
	import Icon from '../components/Icon.svelte';
	import { DEFAULT_GIT_PROXY, DEMO_REPO, PUBLIC_TEST_PROXY } from '../config';
	import { href, router } from '../router.svelte';
	import { app, DEMO_ID } from '../state.svelte';

	let provider = $state<ProviderId>('github');
	let repo = $state('');
	let branch = $state('');
	let token = $state('');
	let username = $state('');
	let proxy = $state(DEFAULT_GIT_PROXY);
	let authorName = $state('');
	let authorEmail = $state('');
	let formError = $state<string | null>(null);

	const info = $derived(PROVIDERS[provider]);
	const parsed = $derived(parseRepo(repo, provider));
	const publicProxyWithToken = $derived(!!token && proxy.replace(/\/$/, '') === PUBLIC_TEST_PROXY);

	function useDemoRepo() {
		provider = DEMO_REPO.provider;
		repo = DEMO_REPO.slug;
		branch = DEMO_REPO.branch;
		token = '';
	}

	/** Use the account's name and no-reply address so commits are attributed. */
	async function lookupAuthor(): Promise<{ name: string; email: string }> {
		if (authorName && authorEmail) return { name: authorName, email: authorEmail };
		try {
			if (provider === 'github' && token) {
				const r = await fetch('https://api.github.com/user', {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (r.ok) {
					const u = (await r.json()) as { login: string; id: number; name: string | null };
					return {
						name: authorName || u.name || u.login,
						email: authorEmail || `${u.id}+${u.login}@users.noreply.github.com`,
					};
				}
			}
			if (provider === 'gitlab' && token) {
				const r = await fetch('https://gitlab.com/api/v4/user', {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (r.ok) {
					const u = (await r.json()) as {
						username: string;
						name: string;
						commit_email?: string;
						public_email?: string;
					};
					return {
						name: authorName || u.name,
						email:
							authorEmail ||
							u.commit_email ||
							u.public_email ||
							`${u.username}@users.noreply.gitlab.com`,
					};
				}
			}
		} catch {
			/* fall through to a generic identity */
		}
		return {
			name: authorName || 'Mycelium',
			email: authorEmail || 'mycelium@users.noreply.github.com',
		};
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		formError = null;
		if (!parsed) {
			formError = 'Enter a repository as owner/name or an HTTPS URL.';
			return;
		}
		const author = await lookupAuthor();
		const ok = await app.connect({
			url: parsed.url,
			provider: parsed.provider,
			slug: parsed.slug,
			branch: branch.trim() || null,
			token: token.trim(),
			username: username.trim(),
			corsProxy: proxy.trim() || null,
			author,
		});
		if (ok) router.go(href.home());
	}

	async function remove(id: string, name: string) {
		if (
			!confirm(
				`Remove the local copy of ${name}? Unsynced changes will be lost. The remote repository is not affected.`,
			)
		)
			return;
		await app.removeVault(id);
	}

	$effect(() => {
		document.title = 'Vaults · Mycelium';
	});
</script>

<div class="page">
	<h1>Vaults</h1>
	<p class="lede">
		Open an org-roam repository from GitHub, GitLab, Bitbucket or any HTTPS git host. It's cloned
		into this browser; you choose when to sync.
	</p>

	<ul class="vaults">
		<li class="vault" class:active={app.activeId === DEMO_ID}>
			<span class="v-icon"><Icon name="zap" size={16} /></span>
			<span class="v-text"
				><span class="v-name">Demo vault</span><span class="v-sub"
					>Built in · edits stay in this tab</span
				></span
			>
			{#if app.activeId === DEMO_ID}<span class="badge">Open</span>{:else}<button
					type="button"
					class="btn small"
					onclick={() => {
						app.useDemo();
						router.go(href.home());
					}}>Open</button
				>{/if}
		</li>
		{#each app.vaults as vault (vault.id)}
			<li class="vault" class:active={app.activeId === vault.id}>
				<span class="v-icon"><Icon name="git" size={16} /></span>
				<span class="v-text">
					<span class="v-name">{vault.name}</span>
					<span class="v-sub"
						>{PROVIDERS[vault.provider].name} · {vault.branch ?? 'default branch'}{vault.credentials
							? ''
							: ' · read-only'}</span
					>
				</span>
				{#if app.activeId === vault.id}<span class="badge">Open</span>{:else}<button
						type="button"
						class="btn small"
						onclick={async () => {
							await app.openVault(vault.id);
							router.go(href.home());
						}}>Open</button
					>{/if}
				<button
					type="button"
					class="btn small danger icon-only"
					aria-label={`Remove ${vault.name}`}
					onclick={() => remove(vault.id, vault.name)}><Icon name="trash" size={15} /></button
				>
			</li>
		{/each}
	</ul>

	<form class="panel stack" onsubmit={submit} aria-labelledby="connect-h">
		<div class="row between">
			<h2 id="connect-h">Connect a repository</h2>
			<button type="button" class="btn small" onclick={useDemoRepo}>Try the public demo repo</button
			>
		</div>

		<div class="field">
			<span class="label" id="provider-label">Git host</span>
			<div class="segmented" role="radiogroup" aria-labelledby="provider-label">
				{#each Object.values(PROVIDERS) as p (p.id)}
					<button
						type="button"
						role="radio"
						aria-checked={provider === p.id}
						onclick={() => (provider = p.id)}>{p.name}</button
					>
				{/each}
			</div>
		</div>

		<div class="field">
			<label for="repo">Repository</label>
			<input
				id="repo"
				class="input"
				bind:value={repo}
				placeholder={provider === 'other'
					? 'https://git.example.com/you/notes.git'
					: 'you/notes or a URL'}
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				required
			/>
			{#if parsed}<span class="hint">Clone URL: <code>{parsed.url}</code></span>{/if}
		</div>

		{#if info.needsUsername}
			<div class="field">
				<label for="username">Username</label>
				<input
					id="username"
					class="input"
					bind:value={username}
					autocomplete="username"
					autocapitalize="off"
				/>
			</div>
		{/if}

		<div class="field">
			<label for="token"
				>Access token <span class="optional">optional for public repositories</span></label
			>
			<input
				id="token"
				class="input"
				type="password"
				bind:value={token}
				autocomplete="off"
				placeholder="Needed to push, or to read private repos"
			/>
			<span class="hint">
				{info.tokenHelp}
				{#if info.tokenUrl}<a href={info.tokenUrl} target="_blank" rel="noopener noreferrer"
						>Create one</a
					>.{/if}
				Stored only in this browser. Sign-in with {info.name} replaces this once OAuth is set up.
			</span>
		</div>

		<details class="advanced">
			<summary>Advanced</summary>
			<div class="stack">
				<div class="field">
					<label for="branch">Branch</label>
					<input
						id="branch"
						class="input"
						bind:value={branch}
						placeholder="Default branch"
						autocapitalize="off"
						spellcheck="false"
					/>
				</div>
				<div class="field">
					<label for="proxy">Sync proxy</label>
					<input
						id="proxy"
						class="input"
						bind:value={proxy}
						placeholder="Leave empty if your git host allows CORS"
						autocapitalize="off"
						spellcheck="false"
					/>
					<span class="hint"
						>Browsers can't talk to git hosts directly. Requests go through this proxy, which can
						see your token in transit. Deploy your own from <code>worker/</code> for private notes.</span
					>
				</div>
				<div class="row two">
					<div class="field">
						<label for="author-name">Commit name</label>
						<input
							id="author-name"
							class="input"
							bind:value={authorName}
							placeholder="From your account"
							autocomplete="name"
						/>
					</div>
					<div class="field">
						<label for="author-email">Commit email</label>
						<input
							id="author-email"
							class="input"
							type="email"
							bind:value={authorEmail}
							placeholder="From your account"
							autocomplete="email"
						/>
					</div>
				</div>
			</div>
		</details>

		{#if publicProxyWithToken}
			<p class="notice warn">
				<Icon name="alert" size={16} /><span
					>Your token would pass through the shared public test proxy. That's fine for a throwaway
					demo repository; for real notes, use a proxy you control.</span
				>
			</p>
		{/if}
		{#if formError || app.loadError}
			<p class="notice error" role="alert">
				<Icon name="alert" size={16} /><span>{formError ?? app.loadError}</span>
			</p>
		{/if}

		<div class="row">
			<button type="submit" class="btn primary" disabled={!!app.loading || !repo.trim()}>
				<Icon name="git" size={16} />{app.loading ? 'Cloning…' : 'Clone and open'}
			</button>
		</div>
	</form>
</div>

<style>
	.vaults {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin: 0 0 1.75rem;
		padding: 0;
		list-style: none;
	}
	.vault {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	.vault.active {
		border-color: color-mix(in oklab, var(--accent) 50%, var(--border));
		box-shadow: 0 0 0 3px var(--accent-softer);
	}
	.v-icon {
		display: grid;
		place-items: center;
		width: 2.1rem;
		height: 2.1rem;
		border-radius: 9px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.v-text {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}
	.v-name {
		overflow: hidden;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.v-sub {
		color: var(--text-muted);
		font-size: 0.78rem;
	}
	.badge {
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-size: 0.75rem;
		font-weight: 650;
	}
	.icon-only {
		width: 2rem;
		padding: 0;
	}
	.between {
		justify-content: space-between;
	}
	h2 {
		margin: 0;
	}
	.optional {
		color: var(--text-muted);
		font-weight: 500;
	}
	.advanced summary {
		color: var(--text-2);
		font-size: 0.86rem;
		font-weight: 600;
		cursor: pointer;
	}
	.advanced[open] summary {
		margin-bottom: 1rem;
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: start;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		overflow-wrap: anywhere;
	}
	@media (max-width: 560px) {
		.two {
			grid-template-columns: 1fr;
		}
		.segmented {
			flex-wrap: wrap;
		}
	}
</style>
