<script lang="ts">
	const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
	import { serviceLabel } from '$lib/sync/services';
	import type { CommitSummary } from '$lib/git/repo';
	import { PROVIDERS } from '$lib/git/providers';
	import Icon from '../components/Icon.svelte';
	import CaptureTemplatesEditor from '../components/CaptureTemplatesEditor.svelte';
	import KeywordEditor from '../components/KeywordEditor.svelte';
	import SettingsTransfer from '../components/SettingsTransfer.svelte';
	import { href, router } from '../router.svelte';
	import { app, TEXT_SIZES, type ThemeChoice } from '../state.svelte';

	const vault = $derived(app.activeVault);

	let token = $state('');
	let proxy = $state(app.activeVault?.corsProxy ?? '');
	let authorName = $state(app.activeVault?.author.name ?? '');
	let authorEmail = $state(app.activeVault?.author.email ?? '');
	let roamDir = $state(app.layout.roamDir);
	let dailyDir = $state(app.layout.dailyDir);
	let dailyFormat = $state(app.layout.dailyFormat);
	let saved = $state<string | null>(null);
	let history = $state<CommitSummary[] | null>(null);

	$effect(() => {
		const ws = app.workspace;
		if (!ws) return;
		void app.unsynced;
		ws.repo.log(15).then((h) => (history = h));
	});

	function flash(message: string) {
		saved = message;
		setTimeout(() => (saved = null), 2500);
	}

	async function saveConnection(e: SubmitEvent) {
		e.preventDefault();
		await app.updateVault({
			corsProxy: proxy.trim() || null,
			author: { name: authorName.trim() || 'Mycelium', email: authorEmail.trim() },
			...(token.trim()
				? { credentials: { token: token.trim(), username: vault?.credentials?.username } }
				: {}),
		});
		token = '';
		flash('Connection saved');
	}

	async function saveLayout(e: SubmitEvent) {
		e.preventDefault();
		await app.updateVault({
			layout: {
				roamDir: roamDir.trim().replace(/^\/+|\/+$/g, ''),
				dailyDir: dailyDir.trim().replace(/^\/+|\/+$/g, '') || 'daily',
				dailyFormat,
			},
		});
		flash('Vault layout saved');
	}

	const themes: { value: ThemeChoice; label: string }[] = [
		{ value: 'system', label: 'System' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
	];

	const date = (t: number) =>
		new Date(t * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	$effect(() => {
		document.title = 'Settings · Mycelium';
	});
</script>

<div class="page">
	<h1>Settings</h1>
	<p class="lede">
		{vault ? `For ${vault.name}.` : 'You are using the demo vault.'}
		<a href={href.vaults()}>Manage vaults</a>
	</p>
	<p class="saved" role="status" aria-live="polite">{saved ?? ''}</p>

	<section class="panel stack" aria-labelledby="appearance-h">
		<h2 id="appearance-h">Appearance</h2>
		<div class="segmented" role="radiogroup" aria-label="Theme">
			{#each themes as t (t.value)}
				<button
					type="button"
					role="radio"
					aria-checked={app.theme === t.value}
					onclick={() => app.setTheme(t.value)}>{t.label}</button
				>
			{/each}
		</div>
		<div class="field">
			<span class="label" id="ts-label">Text size</span>
			<div class="segmented" role="radiogroup" aria-labelledby="ts-label">
				{#each TEXT_SIZES as s (s.value)}
					<button
						type="button"
						role="radio"
						aria-checked={app.textSize === s.value}
						onclick={() => app.setTextSize(s.value)}>{s.label}</button
					>
				{/each}
			</div>
			<p class="preview">
				The quick brown fox links two notes. <span class="hint"
					>Ctrl/⌘ + Alt + = / − / 0 also change it.</span
				>
			</p>
		</div>
	</section>

	<section class="panel stack" aria-labelledby="workflow-h">
		<h2 id="workflow-h">Workflow: TODO keywords</h2>
		{#key app.activeId}<KeywordEditor />{/key}
	</section>

	<section class="panel stack" aria-labelledby="capture-h">
		<h2 id="capture-h">Capture templates</h2>
		{#key app.activeId}<CaptureTemplatesEditor />{/key}
	</section>

	<section class="panel stack" aria-labelledby="transfer-h">
		<h2 id="transfer-h">Settings file</h2>
		{#key app.activeId}<SettingsTransfer />{/key}
	</section>

	<section class="panel stack" aria-labelledby="logging-h">
		<h2 id="logging-h">Task logging</h2>
		<p class="hint">
			Mirrors org's logging options. Detected from your files; Emacs' defaults otherwise.
		</p>
		<label class="check"
			><input
				type="checkbox"
				checked={app.logSettings.logDone}
				onchange={(e) =>
					app
						.updateVault({ log: { ...(vault?.log ?? {}), logDone: e.currentTarget.checked } })
						.then(() => (app.logSettings.logDone = e.currentTarget.checked))}
			/>
			Stamp <code>CLOSED:</code> when a task is done <span class="var">org-log-done</span></label
		>
		<label class="check"
			><input
				type="checkbox"
				checked={app.logSettings.logRepeat}
				onchange={(e) =>
					app
						.updateVault({ log: { ...(vault?.log ?? {}), logRepeat: e.currentTarget.checked } })
						.then(() => (app.logSettings.logRepeat = e.currentTarget.checked))}
			/>
			Record <code>LAST_REPEAT</code> and a state note when a repeating task is done
			<span class="var">org-log-repeat</span></label
		>
		<label class="check"
			><input
				type="checkbox"
				checked={app.logSettings.logIntoDrawer !== null}
				onchange={(e) => {
					const v = e.currentTarget.checked ? 'LOGBOOK' : null;
					app
						.updateVault({ log: { ...(vault?.log ?? {}), logIntoDrawer: v } })
						.then(() => (app.logSettings.logIntoDrawer = v));
				}}
			/>
			Put state notes in a <code>:LOGBOOK:</code> drawer
			<span class="var">org-log-into-drawer</span></label
		>
	</section>

	{#if vault?.cloud}
		<section class="panel stack" aria-labelledby="conn-h">
			<h2 id="conn-h">{serviceLabel(vault.cloud)}</h2>
			<dl class="facts">
				<dt>Folder</dt>
				<dd><code>{vault.cloud.root || '/'}</code></dd>
				{#if vault.cloud.url}<dt>Server</dt>
					<dd><code>{vault.cloud.url}</code></dd>{/if}
				{#if vault.cloud.account}<dt>Account</dt>
					<dd>{vault.cloud.account}</dd>{/if}
				<dt>Access</dt>
				<dd>
					{vault.cloud.service === 'webdav'
						? 'App password kept only in this browser'
						: 'Signed in; the sign-in is kept only in this browser'}{vault.cloud.service ===
						'webdav' && vault.cloud.proxy
						? ' · through the sync relay'
						: ''}
				</dd>
			</dl>
		</section>
	{/if}
	{#if vault}
		{#if !vault.cloud}
			<form class="panel stack" onsubmit={saveConnection} aria-labelledby="conn-h">
				<h2 id="conn-h">Repository</h2>
				<dl class="facts">
					<dt>Remote</dt>
					<dd><code>{vault.url}</code></dd>
					<dt>Host</dt>
					<dd>{PROVIDERS[vault.provider].name}</dd>
					<dt>Branch</dt>
					<dd><Icon name="branch" size={14} /> {vault.branch ?? 'default'}</dd>
					<dt>Access</dt>
					<dd>{vault.credentials ? 'Token saved in this browser' : 'Read-only (no token)'}</dd>
				</dl>
				<div class="field">
					<label for="s-token"
						>{vault.credentials ? 'Replace access token' : 'Add an access token'}</label
					>
					<input id="s-token" class="input" type="password" bind:value={token} autocomplete="off" />
				</div>
				<div class="field">
					<label for="s-proxy">Sync proxy</label>
					<input
						id="s-proxy"
						class="input"
						bind:value={proxy}
						autocapitalize="off"
						spellcheck="false"
					/>
				</div>
				<div class="row two">
					<div class="field">
						<label for="s-an">Commit name</label><input
							id="s-an"
							class="input"
							bind:value={authorName}
						/>
					</div>
					<div class="field">
						<label for="s-ae">Commit email</label><input
							id="s-ae"
							class="input"
							type="email"
							bind:value={authorEmail}
						/>
					</div>
				</div>
				<div class="row"><button class="btn primary" type="submit">Save</button></div>
			</form>
		{/if}

		<form class="panel stack" onsubmit={saveLayout} aria-labelledby="layout-h">
			<h2 id="layout-h">Vault layout</h2>
			<div class="row two">
				<div class="field">
					<label for="s-roam">org-roam directory</label>
					<input id="s-roam" class="input" bind:value={roamDir} placeholder="Repository root" />
				</div>
				<div class="field">
					<label for="s-daily">Dailies directory</label>
					<input id="s-daily" class="input" bind:value={dailyDir} />
				</div>
			</div>
			<div class="field">
				<label for="s-format">Daily file names</label>
				<select id="s-format" class="input" bind:value={dailyFormat}>
					<option value="YYYY-MM-DD">2026-10-20.org (org-roam default)</option>
					<option value="YYYYMMDD">20261020.org</option>
				</select>
			</div>

			<div class="row"><button class="btn primary" type="submit">Save and re-index</button></div>
		</form>

		{#if !vault.cloud}
			<section class="panel" aria-labelledby="history-h">
				<h2 id="history-h">Recent history</h2>
				{#if history === null}
					<p class="hint">Loading…</p>
				{:else if history.length === 0}
					<p class="hint">No commits yet.</p>
				{:else}
					<ol class="history">
						{#each history as c, i (c.oid)}
							<li>
								<span class="msg">{c.message}</span>
								<span class="meta"
									>{c.author.name} · {date(c.author.timestamp)} ·
									<code>{c.oid.slice(0, 7)}</code>{#if i < app.unsynced}
										· <span class="local">not synced</span>{/if}</span
								>
							</li>
						{/each}
					</ol>
				{/if}
			</section>
		{/if}

		<section class="panel stack" aria-labelledby="danger-h">
			<h2 id="danger-h">Remove from this browser</h2>
			<p class="hint">
				{vault.cloud
					? `Deletes this browser's copy. The folder in ${serviceLabel(vault.cloud)} is not affected`
					: 'Deletes the local clone and index. The remote repository is not affected'}{app.unsynced
					? `, but your ${app.unsynced} unsynced ${app.unsynced === 1 ? 'change' : 'changes'} will be lost`
					: ''}.
			</p>
			<div class="row">
				<button
					type="button"
					class="btn danger"
					onclick={async () => {
						if (confirm(`Remove ${vault.name} from this browser?`)) {
							await app.removeVault(vault.id);
							router.go(href.home());
						}
					}}
				>
					<Icon name="trash" size={15} /> Remove vault
				</button>
			</div>
		</section>
	{/if}

	<section class="panel stack" aria-labelledby="about-h">
		<h2 id="about-h">About Mycelium</h2>
		<p class="hint">
			Mycelium is free software: you can redistribute it and change it under the terms of the GNU
			General Public License, version 3 or (at your option) any later version. It comes with no
			warranty.
		</p>
		<p class="about-links">
			<a href="https://github.com/jackhale98/mycelium-web" rel="noopener noreferrer">Source code</a>
			<a href="https://www.gnu.org/licenses/gpl-3.0.html" rel="noopener noreferrer">GNU GPL v3</a>
			<a href={`${BASE}/third-party-licenses.txt`}>Third-party licences</a>
		</p>
		<p class="hint">Not affiliated with org-roam or the GNU Emacs project.</p>
	</section>
</div>

<style>
	.about-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.2rem;
		margin: 0;
		font-size: 0.88rem;
	}
	.about-links a {
		color: var(--link);
	}
	.preview {
		margin: 0.4rem 0 0;
		font-family: var(--font-read);
		font-size: 1.1rem;
	}
	.preview .hint {
		display: block;
		font-family: var(--font-ui);
		font-size: 0.78rem;
	}
	.lede a {
		color: var(--link);
	}
	.saved {
		min-height: 1.2rem;
		margin: -1.25rem 0 0.75rem;
		color: var(--accent);
		font-size: 0.85rem;
		font-weight: 600;
	}
	h2 {
		margin: 0;
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.82rem;
	}
	.check {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	.check input {
		accent-color: var(--accent);
		transform: translateY(1px);
	}
	.var {
		color: var(--text-faint);
		font-family: var(--font-mono);
		font-size: 0.72rem;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.82em;
		overflow-wrap: anywhere;
	}
	.facts {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.4rem 1rem;
		margin: 0;
		font-size: 0.88rem;
	}
	.facts dt {
		color: var(--text-muted);
	}
	.facts dd {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin: 0;
		min-width: 0;
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: start;
	}
	.history {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.history li {
		display: flex;
		flex-direction: column;
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--border);
	}
	.history li:last-child {
		border-bottom: 0;
	}
	.msg {
		font-size: 0.9rem;
		font-weight: 550;
	}
	.meta {
		color: var(--text-muted);
		font-size: 0.76rem;
	}
	.local {
		color: var(--todo);
		font-weight: 600;
	}
	@media (max-width: 560px) {
		.two {
			grid-template-columns: 1fr;
		}
	}
</style>
