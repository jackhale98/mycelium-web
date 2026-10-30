<script lang="ts">
	import { orgDurationUnitsLisp } from '$lib/org';
	import { SWIPE_LABELS } from '../swipe';
	const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
	import RemindersSettings from '../components/RemindersSettings.svelte';
	import StuckEditor from '../components/StuckEditor.svelte';
	import { serviceLabel } from '$lib/sync/services';
	import type { CommitSummary } from '$lib/git/repo';
	import { PROVIDERS } from '$lib/git/providers';
	import Icon from '../components/Icon.svelte';
	import CaptureTemplatesEditor from '../components/CaptureTemplatesEditor.svelte';
	import KeywordEditor from '../components/KeywordEditor.svelte';
	import SettingsTransfer from '../components/SettingsTransfer.svelte';
	import { href, router } from '../router.svelte';
	import {
		app,
		DEFAULT_SWIPE_TRAY,
		SWIPE_CHOICES,
		TEXT_SIZES,
		type SwipeChoice,
		type ThemeChoice,
	} from '../state.svelte';

	let { tab = null }: { tab?: string | null } = $props();

	const TABS = [
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'tasks', label: 'Tasks' },
		{ id: 'capture', label: 'Capture' },
		{ id: 'reminders', label: 'Reminders' },
		{ id: 'vault', label: 'Vault' },
		{ id: 'about', label: 'About' },
	] as const;
	const current = $derived(TABS.some((t) => t.id === tab) ? tab : 'appearance');

	const vault = $derived(app.activeVault);

	let token = $state('');
	let proxy = $state(app.activeVault?.corsProxy ?? '');
	let authorName = $state(app.activeVault?.author.name ?? '');
	let authorEmail = $state(app.activeVault?.author.email ?? '');
	let roamDir = $state(app.layout.roamDir);
	let dailyDir = $state(app.layout.dailyDir);
	let dailyFormat = $state(app.layout.dailyFormat);
	let imageDir = $state(app.imageDir);
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
			imageDir: imageDir.trim().replace(/^\/+|\/+$/g, ''),
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

	<nav class="tabs" aria-label="Settings sections">
		{#each TABS as t (t.id)}
			<a
				href={href.settings(t.id === 'appearance' ? undefined : t.id)}
				aria-current={current === t.id ? 'page' : undefined}>{t.label}</a
			>
		{/each}
	</nav>

	{#if current === 'appearance'}
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
			<div class="field">
				<span class="label" id="lb-label">Line breaks in paragraphs</span>
				<div class="segmented" role="radiogroup" aria-labelledby="lb-label">
					<button
						type="button"
						role="radio"
						aria-checked={!app.joinLines}
						onclick={() => app.setJoinLines(false)}>Keep as written</button
					>
					<button
						type="button"
						role="radio"
						aria-checked={app.joinLines}
						onclick={() => app.setJoinLines(true)}>Join into paragraphs</button
					>
				</div>
				<p class="hint">
					Keep shows each line where you broke it, as Emacs does. Join flows lines together, as
					org's HTML export does; pick it if you wrap lines with M-q.
				</p>
			</div>
			<div class="field">
				<span class="label" id="ed-label">Editor</span>
				<div class="segmented" role="radiogroup" aria-labelledby="ed-label">
					<button
						type="button"
						role="radio"
						aria-checked={app.livePreview}
						onclick={() => app.setLivePreview(true)}>Live preview</button
					>
					<button
						type="button"
						role="radio"
						aria-checked={!app.livePreview}
						onclick={() => app.setLivePreview(false)}>Source</button
					>
				</div>
				<p class="hint">
					Live preview hides markup (emphasis marks, leading stars, link brackets) except where the
					cursor is, draws bullets and checkboxes, and typesets maths. Source shows the org text as
					it is.
				</p>
			</div>
		</section>
		<section class="panel stack" aria-labelledby="links-h">
			<h2 id="links-h">Link suggestions</h2>
			<p class="hint">
				Other notes' titles and aliases written as plain text in a note are suggested as links:
				underlined in the text, and listed under the note's backlinks. Linking writes an ordinary
				<code>[[id:…][words]]</code> link, keeping your words.
			</p>
			<label class="check"
				><input
					type="checkbox"
					checked={app.mentionMarks}
					onchange={(e) => app.setMentionMarks(e.currentTarget.checked)}
				/>
				Underline suggestions in the text (reading and editing)</label
			>
			<label class="check"
				><input
					type="checkbox"
					checked={app.mentionEvery}
					onchange={(e) => app.setMentionEvery(e.currentTarget.checked)}
				/>
				Suggest every mention of a note, not just the first in each note</label
			>
			{#if app.mentionIgnore.length}
				<div class="field">
					<span class="label" id="ign-label">Never suggested</span>
					<ul class="ignored" aria-labelledby="ign-label">
						{#each app.mentionIgnore as id (id)}
							<li>
								<span>{app.vault.node(id)?.title ?? id}</span>
								<button
									type="button"
									class="btn small"
									onclick={() => void app.ignoreMention(id, false)}>Suggest again</button
								>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</section>
	{:else if current === 'tasks'}
		<section class="panel stack" aria-labelledby="workflow-h">
			<h2 id="workflow-h">Workflow: TODO keywords</h2>
			{#key app.activeId}<KeywordEditor />{/key}
		</section>
		<section class="panel stack" aria-labelledby="inbox-h">
			<h2 id="inbox-h">Inbox and weekly review</h2>
			<p class="hint">
				The inbox is a file whose top-level headings are things not yet decided (or, under a heading
				captures are filed under, its sub-headings): <a href={href.triage()}>Process the inbox</a> goes
				through them one at a time. The Task capture template collects there.
			</p>
			<label class="field"
				><span>Inbox file</span>
				<input
					class="input"
					list="s-inbox-files"
					value={app.activeVault?.inbox ?? 'inbox.org'}
					placeholder="inbox.org"
					autocapitalize="off"
					spellcheck="false"
					onchange={(e) => app.updateVault({ inbox: e.currentTarget.value.trim() })}
				/>
				<datalist id="s-inbox-files"
					>{#each [...app.vault.files.keys()].sort() as p (p)}<option value={p}
						></option>{/each}</datalist
				>
				<span class="hint"
					>{app.inboxPath
						? `${app.inbox.length} undecided in ${app.inboxPath}`
						: 'No such file yet: it will count once it exists.'}</span
				>
			</label>
			<fieldset class="waiting">
				<legend>Waiting states (shown in the review's “Waiting on others”)</legend>
				{#each app.vault.keywords.todoKeywords as k (k)}
					<label class="check"
						><input
							type="checkbox"
							checked={app.waitKeywords.includes(k)}
							onchange={(e) =>
								app.updateVault({
									waitKeywords: e.currentTarget.checked
										? [...app.waitKeywords, k]
										: app.waitKeywords.filter((w) => w !== k),
								})}
						/>
						{k}</label
					>
				{/each}
			</fieldset>
			<div class="hours">
				<label class="field"
					><span>Working day starts</span><input
						type="time"
						class="input"
						value={app.workHours.start}
						onchange={(e) =>
							e.currentTarget.value &&
							app.updateVault({ workHours: { ...app.workHours, start: e.currentTarget.value } })}
					/></label
				>
				<label class="field"
					><span>and ends</span><input
						type="time"
						class="input"
						value={app.workHours.end}
						onchange={(e) =>
							e.currentTarget.value &&
							app.updateVault({ workHours: { ...app.workHours, end: e.currentTarget.value } })}
					/></label
				>
			</div>
			<p class="hint">The planner counts free time between these.</p>
		</section>
		<section class="panel stack" aria-labelledby="effort-h">
			<h2 id="effort-h">Effort estimates</h2>
			<p class="hint">
				An <code>Effort</code> is a task's whole estimate (<code>0:30</code>, <code>3h</code>,
				<code>2d</code>). The planner plans it in sessions: timestamps in the task, one per stretch
				of work. How long a “day” of effort is follows org's
				<span class="var">org-duration-units</span>: 24 hours unless you count working days.
			</p>
			<div class="hours">
				<label class="field"
					><span>A day of effort is</span>
					<span class="unit"
						><input
							type="number"
							class="input"
							min="1"
							max="24"
							step="0.5"
							value={app.activeVault?.effortDayHours ?? 24}
							onchange={(e) => {
								const v = Number(e.currentTarget.value);
								if (v >= 1 && v <= 24) app.updateVault({ effortDayHours: v });
							}}
						/> hours</span
					></label
				>
				<label class="field"
					><span>A week of effort is</span>
					<span class="unit"
						><input
							type="number"
							class="input"
							min="1"
							max="7"
							step="1"
							value={app.activeVault?.effortWeekDays ?? 7}
							onchange={(e) => {
								const v = Number(e.currentTarget.value);
								if (v >= 1 && v <= 7) app.updateVault({ effortWeekDays: v });
							}}
						/> days</span
					></label
				>
			</div>
			<p class="hint">
				So <code>2d</code> is {(app.effortUnits['d']! * 2) / 60} hours of work. For Emacs to read durations
				the same way, add this to its configuration:
			</p>
			<pre class="lisp"><code>{orgDurationUnitsLisp(app.effortUnits)}</code></pre>
			<button
				type="button"
				class="btn small"
				onclick={() => navigator.clipboard?.writeText(orgDurationUnitsLisp(app.effortUnits))}
				>Copy</button
			>
		</section>
		<section class="panel stack" aria-labelledby="swipe-h">
			<h2 id="swipe-h">Swipe actions</h2>
			<p class="hint">
				On touch screens, swipe a task to the right to mark it done (or reopen it), or to the left
				for buttons: the two you choose here, then More for everything else. Saved on this device.
			</p>
			<div class="swipe-picks">
				{#each [0, 1] as slot (slot)}
					<label class="field">
						<span>{slot === 0 ? 'First button' : 'Second button'}</span>
						<select
							class="input"
							value={app.swipeTray[slot]}
							onchange={(e) => {
								const picks = [...app.swipeTray];
								const choice = e.currentTarget.value as SwipeChoice;
								// Choosing what the other slot has swaps them.
								const other = picks.indexOf(choice);
								if (other !== -1 && other !== slot) picks[other] = picks[slot]!;
								picks[slot] = choice;
								app.setSwipeTray(picks);
							}}
						>
							{#each SWIPE_CHOICES as c (c)}<option value={c}>{SWIPE_LABELS[c]}</option>{/each}
						</select>
					</label>
				{/each}
			</div>
			<p class="swipe-preview" aria-label="Preview of the buttons a left swipe shows">
				{#each app.swipeTray as c (c)}<span>{SWIPE_LABELS[c]}</span>{/each}<span class="more"
					>More</span
				>
			</p>
			<button
				type="button"
				class="btn small"
				disabled={app.swipeTray.join() === DEFAULT_SWIPE_TRAY.join()}
				onclick={() => app.setSwipeTray([...DEFAULT_SWIPE_TRAY])}>Use the defaults</button
			>
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
		<section class="panel stack" aria-labelledby="stuck-h">
			<h2 id="stuck-h">Stuck projects</h2>
			<p class="hint">
				What the agenda’s Stuck view lists, as org’s <code>org-stuck-projects</code> defines it: projects
				with no next action under them.
			</p>
			<StuckEditor idPrefix="s-stuck" />
		</section>
	{:else if current === 'capture'}
		<section class="panel stack" aria-labelledby="capture-h">
			<h2 id="capture-h">Capture templates</h2>
			{#key app.activeId}<CaptureTemplatesEditor />{/key}
		</section>
	{:else if current === 'reminders'}
		<section class="panel stack" aria-labelledby="reminders-h">
			<h2 id="reminders-h">Reminders</h2>
			<RemindersSettings />
		</section>
	{:else if current === 'vault'}
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
						<input
							id="s-token"
							class="input"
							type="password"
							bind:value={token}
							autocomplete="off"
						/>
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
				<div class="field">
					<label for="s-images">Pictures folder</label>
					<input id="s-images" class="input" bind:value={imageDir} placeholder="Vault root" />
					<p class="hint">
						Pictures you add are saved here, linked from the note with a relative <code>file:</code> link.
					</p>
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

		{#if !vault}
			<p class="hint">
				The demo vault has no connection or layout to change. <a href={href.vaults()}
					>Open your own vault</a
				> to set one up.
			</p>
		{/if}
	{:else}
		<section class="panel stack" aria-labelledby="transfer-h">
			<h2 id="transfer-h">Settings file</h2>
			{#key app.activeId}<SettingsTransfer />{/key}
		</section>
		<section class="panel stack" aria-labelledby="about-h">
			<h2 id="about-h">About Mycelium</h2>
			<p class="hint">
				Mycelium is free software: you can redistribute it and change it under the terms of the GNU
				General Public License, version 3 or (at your option) any later version. It comes with no
				warranty.
			</p>
			<p class="about-links">
				<a href="https://github.com/jackhale98/mycelium-web" rel="noopener noreferrer"
					>Source code</a
				>
				<a href="https://www.gnu.org/licenses/gpl-3.0.html" rel="noopener noreferrer">GNU GPL v3</a>
				<a href={`${BASE}/third-party-licenses.txt`}>Third-party licences</a>
			</p>
			<p class="hint">Not affiliated with org-roam or the GNU Emacs project.</p>
		</section>
	{/if}
</div>

<style>
	/* Sections as a row of tabs: wraps on desktop, scrolls sideways on phones. */
	.tabs {
		position: sticky;
		top: var(--clock-h, 0px);
		z-index: 2;
		display: flex;
		gap: 0.3rem;
		margin: 0 0 1rem;
		padding: 0.4rem 0;
		background: var(--bg);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tabs::-webkit-scrollbar {
		display: none;
	}
	.tabs a {
		flex: none;
		display: inline-flex;
		align-items: center;
		min-height: 2.25rem;
		padding: 0 0.9rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-muted);
		font-size: 0.86rem;
		font-weight: 600;
		text-decoration: none;
	}
	.tabs a:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.tabs a[aria-current='page'] {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent-strong);
	}
	@media (pointer: coarse) {
		.tabs a {
			min-height: 2.75rem;
		}
	}
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
	.swipe-picks {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0.75rem;
	}
	.swipe-preview {
		display: flex;
		max-width: 22rem;
		margin: 0;
		overflow: hidden;
		border-radius: 10px;
		font-size: 0.78rem;
		font-weight: 650;
	}
	.swipe-preview span {
		flex: 1;
		padding: 0.6rem 0.4rem;
		background: var(--surface-3);
		text-align: center;
	}
	.swipe-preview .more {
		background: var(--accent);
		color: var(--on-accent);
	}
	.waiting {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.waiting legend {
		margin-bottom: 0.35rem;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.hours {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 12rem));
		gap: 0.75rem;
	}
	.unit {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.unit .input {
		width: 5.5rem;
	}
	.lisp {
		margin: 0;
		padding: 0.6rem 0.75rem;
		overflow-x: auto;
		border-radius: 8px;
		background: var(--code-bg);
		font-size: 0.78rem;
	}
	.ignored {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.ignored li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
</style>
