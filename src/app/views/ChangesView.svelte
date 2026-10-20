<script lang="ts">
	import type { CommitSummary } from '$lib/git/repo';
	import { diffLines, type DiffHunk } from '$lib/git/diff';
	import Icon from '../components/Icon.svelte';
	import { app } from '../state.svelte';

	const STATUS = { added: 'A', modified: 'M', deleted: 'D' } as const;

	let message = $state('');
	let excluded = $state<Set<string>>(new Set());
	/** Diffs the person opened or closed; others follow the default (open for ≤3 files). */
	let toggled = $state<Map<string, boolean>>(new Map());
	let diffs = $state<
		Map<string, { hunks: DiffHunk[]; headings: (string | null)[]; added: number; removed: number }>
	>(new Map());
	let history = $state<CommitSummary[]>([]);
	let branches = $state<{ current: string; local: string[]; remote: string[] }>({
		current: '',
		local: [],
		remote: [],
	});
	let newBranch = $state('');
	let committing = $state(false);

	const changes = $derived(app.git.changes);
	const selected = $derived(changes.filter((c) => !excluded.has(c.path)).map((c) => c.path));
	const busy = $derived(app.sync.kind === 'busy');

	$effect(() => {
		document.title = 'Changes · Mycelium';
	});

	// Reload history and branches whenever HEAD may have moved.
	$effect(() => {
		void app.git.branch;
		void app.git.ahead;
		void app.git.behind;
		const ws = app.workspace;
		if (!ws) return;
		void ws.repo.log(30).then((h) => (history = h));
		void ws.branches().then((b) => (branches = b));
	});

	const isOpen = (path: string) => toggled.get(path) ?? changes.length <= 3;
	const allOpen = $derived(changes.length > 0 && changes.every((c) => isOpen(c.path)));

	/** The nearest org heading at or above a 1-based line, for hunk context. */
	function headingAbove(lines: string[], line: number): string | null {
		for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
			const m = /^(\*+)[ \t]+(.*)$/.exec(lines[i]!);
			if (m) return `${m[1]} ${m[2]!.replace(/[ \t]+:[\w@#%:]+:[ \t]*$/, '').trim()}`;
		}
		return null;
	}

	// Load (and refresh, as files change) the diff and +/- counts of every changed file.
	$effect(() => {
		void app.rev;
		const ws = app.workspace;
		const paths = changes.map((c) => c.path);
		if (!ws) return;
		let cancelled = false;
		void Promise.all(
			paths.map(async (path) => {
				const { before, after } = await ws.diff(path);
				const hunks = diffLines(before ?? '', after ?? '');
				const lines = (after ?? before ?? '').split('\n');
				const headings = hunks.map((h) =>
					headingAbove(lines, after === null ? h.oldStart : h.newStart),
				);
				let added = 0;
				let removed = 0;
				for (const h of hunks)
					for (const l of h.lines) {
						if (l.kind === 'add') added++;
						else if (l.kind === 'remove') removed++;
					}
				return [path, { hunks, headings, added, removed }] as const;
			}),
		).then((entries) => {
			if (!cancelled) diffs = new Map(entries);
		});
		return () => (cancelled = true);
	});

	function toggle(path: string) {
		const next = new Set(excluded);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		excluded = next;
	}

	function show(path: string) {
		toggled = new Map(toggled).set(path, !isOpen(path));
	}

	function setAll(value: boolean) {
		toggled = new Map(changes.map((c) => [c.path, value]));
	}

	async function commit(e?: Event) {
		e?.preventDefault();
		if (!message.trim() || selected.length === 0 || committing) return;
		committing = true;
		try {
			if (await app.commit(selected, message)) {
				message = '';
				excluded = new Set();
				toggled = new Map();
			}
		} finally {
			committing = false;
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void commit(e);
	}

	async function discard(path: string) {
		if (!confirm(`Discard your uncommitted changes to ${path}? This can't be undone.`)) return;
		await app.discard(path);
	}

	async function create(e: Event) {
		e.preventDefault();
		const name = newBranch.trim();
		if (!name) return;
		await app.createBranch(name);
		newBranch = '';
	}

	function when(ts: number) {
		const d = new Date(ts * 1000);
		const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
		if (days < 1) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		if (days < 7)
			return d.toLocaleDateString(undefined, {
				weekday: 'short',
				hour: 'numeric',
				minute: '2-digit',
			});
		return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}
</script>

<div class="page wide">
	<h1>Changes</h1>
	<p class="lede">
		Edits save to the working tree as you type. Pick what to commit, write a message, and push when
		you're ready.
	</p>

	{#if app.folder}
		<div class="notice info">
			<Icon name="folder" size={16} />
			<span
				>This vault is the folder <strong>{app.folder.record.name}</strong> on your computer. Edits are
				saved straight to its files — review and commit them with git (or anything else) as you normally
				would.</span
			>
		</div>
	{:else if !app.workspace}
		<div class="notice">
			<Icon name="info" size={16} />
			<span
				>This browser can't store a git repository (private window?), so the demo runs in memory
				only.</span
			>
		</div>
	{:else}
		<section class="panel bar" aria-label="Branch and remote">
			<div class="row">
				<label class="branch-pick">
					<Icon name="branch" size={15} />
					<span class="sr-only">Branch</span>
					<select
						value={branches.current}
						disabled={busy}
						onchange={(e) => app.switchBranch(e.currentTarget.value)}
					>
						{#each branches.local as b (b)}<option value={b}>{b}</option>{/each}
						{#if branches.remote.length}
							<optgroup label="Remote">
								{#each branches.remote as b (b)}<option value={b}>origin/{b}</option>{/each}
							</optgroup>
						{/if}
					</select>
				</label>
				<form class="new-branch" onsubmit={create}>
					<input
						class="input"
						placeholder="new-branch"
						aria-label="New branch name"
						bind:value={newBranch}
						pattern="[^\s~^:?*\[\\]+"
					/>
					<button class="btn small" disabled={!newBranch.trim() || busy}>Create</button>
				</form>
				{#if app.git.hasRemote}
					<div class="remote">
						<span class="ab" title="Behind / ahead of origin"
							>↓{app.git.behind} ↑{app.git.ahead}</span
						>
						<button
							type="button"
							class="btn small"
							disabled={busy}
							onclick={() => app.fetchRemote()}>Fetch</button
						>
						<button type="button" class="btn small" disabled={busy} onclick={() => app.pull()}
							><Icon name="download" size={14} />Pull</button
						>
						<button
							type="button"
							class="btn small"
							class:primary={app.git.ahead > 0}
							disabled={busy}
							onclick={() => app.push()}><Icon name="upload" size={14} />Push</button
						>
					</div>
				{:else}
					<span class="ab">No remote — commits stay in this browser</span>
				{/if}
			</div>
		</section>

		<section class="panel" aria-labelledby="wt-h">
			<div class="wt-head">
				<h2 id="wt-h">
					Working tree <span class="muted"
						>{changes.length ? `${changes.length} changed` : 'clean'}</span
					>
				</h2>
				{#if changes.length > 1}
					<button type="button" class="btn small" onclick={() => setAll(!allOpen)}
						>{allOpen ? 'Collapse all' : 'Expand all'}</button
					>
				{/if}
			</div>
			{#if changes.length === 0}
				<p class="empty">Nothing to commit. Edit a note and it shows up here.</p>
			{:else}
				<ul class="files">
					{#each changes as c (c.path)}
						{@const d = diffs.get(c.path)}
						{@const opened = isOpen(c.path)}
						<li class:open={opened}>
							<div class="file-row">
								<input
									type="checkbox"
									checked={!excluded.has(c.path)}
									onchange={() => toggle(c.path)}
									aria-label={`Include ${c.path} in commit`}
								/>
								<button
									type="button"
									class="toggle"
									onclick={() => show(c.path)}
									aria-expanded={opened}
									aria-controls={`diff-${c.path}`}
								>
									<span class={`st ${c.status}`} title={c.status}>{STATUS[c.status]}</span>
									<span class="path">{c.path}</span>
									{#if d}<span class="counts"
											><span class="plus">+{d.added}</span><span class="minus">−{d.removed}</span
											></span
										>{/if}
									<span class="chev" class:up={opened}><Icon name="chevronDown" size={16} /></span>
								</button>
								<button
									type="button"
									class="icon-btn"
									aria-label={`Discard changes to ${c.path}`}
									title="Discard changes"
									onclick={() => discard(c.path)}><Icon name="undo" size={15} /></button
								>
							</div>
							{#if opened}
								<div
									class="diff"
									id={`diff-${c.path}`}
									role="region"
									aria-label={`Diff of ${c.path}`}
								>
									{#if !d}
										<p class="empty">Loading…</p>
									{:else if d.hunks.length === 0}
										<p class="empty">No textual changes.</p>
									{:else}
										{#each d.hunks as hunk, i (i)}
											<div class="hunk-head">
												<span>@@ −{hunk.oldStart} +{hunk.newStart} @@</span>
												{#if d.headings[i]}<span class="in">{d.headings[i]}</span>{/if}
											</div>
											{#each hunk.lines as line, j (j)}
												<div class={`ln ${line.kind}`}>
													<span class="no old">{line.oldNo ?? ''}</span><span class="no"
														>{line.newNo ?? line.oldNo ?? ''}</span
													><span class="sign"
														>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span
													><code>{line.text || ' '}</code>
												</div>
											{/each}
										{/each}
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				<form class="commit" onsubmit={commit}>
					<label class="sr-only" for="commit-msg">Commit message</label>
					<textarea
						id="commit-msg"
						class="input"
						rows="3"
						placeholder="Commit message"
						bind:value={message}
						{onkeydown}></textarea>
					<div class="row between">
						<span class="hint">{selected.length} of {changes.length} files · ⌘/Ctrl + Enter</span>
						<button
							class="btn primary"
							disabled={!message.trim() || selected.length === 0 || committing}
							><Icon name="commit" size={15} />Commit</button
						>
					</div>
				</form>
			{/if}
			<label class="auto">
				<input
					type="checkbox"
					checked={!!app.activeVault?.autoCommit}
					onchange={(e) => app.updateVault({ autoCommit: e.currentTarget.checked })}
				/>
				Commit every edit automatically (one commit per change, with a generated message)
			</label>
		</section>

		<section class="panel" aria-labelledby="hist-h">
			<h2 id="hist-h"><Icon name="history" size={16} /> History</h2>
			{#if history.length === 0}
				<p class="empty">No commits yet.</p>
			{:else}
				<ol class="history">
					{#each history as c, i (c.oid)}
						<li>
							<span class="oid">{c.oid.slice(0, 7)}</span>
							<span class="msg">{c.message.split('\n')[0]}</span>
							{#if i < app.git.ahead}<span class="tag">unpushed</span>{/if}
							<span class="meta">{c.author.name} · {when(c.author.timestamp)}</span>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	{/if}
</div>

<style>
	.wide {
		max-width: 56rem;
	}
	.bar .row {
		gap: 0.75rem;
	}
	.branch-pick {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--text-2);
	}
	select {
		height: 2rem;
		padding: 0 0.5rem;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 0.82rem;
	}
	.new-branch {
		display: flex;
		gap: 0.4rem;
	}
	.new-branch .input {
		width: 9.5rem;
		height: 2rem;
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}
	.remote {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-left: auto;
	}
	.ab {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.78rem;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.muted {
		color: var(--text-muted);
		font-size: 0.82rem;
		font-weight: 500;
	}
	.empty {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.88rem;
	}
	.files {
		margin: 0 0 1rem;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		list-style: none;
		overflow: hidden;
	}
	.files li + li {
		border-top: 1px solid var(--border);
	}
	.wt-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.wt-head h2 {
		margin: 0;
	}
	.file-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0 0.35rem 0 0.7rem;
	}
	.toggle {
		display: flex;
		flex: 1;
		min-width: 0;
		align-items: center;
		gap: 0.6rem;
		min-height: 2.75rem;
		padding: 0.4rem 0.3rem;
		border: 0;
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.toggle:hover .path {
		color: var(--accent);
	}
	.counts {
		display: flex;
		gap: 0.4rem;
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 0.74rem;
		font-weight: 600;
	}
	.plus {
		color: var(--accent);
	}
	.minus {
		color: var(--danger);
	}
	.chev {
		display: grid;
		color: var(--text-muted);
		transition: transform 0.15s var(--ease);
	}
	.chev.up {
		transform: rotate(180deg);
	}
	.st {
		display: grid;
		place-items: center;
		width: 1.3rem;
		height: 1.3rem;
		border-radius: 5px;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		font-weight: 700;
	}
	.st.modified {
		background: var(--todo-soft);
		color: var(--todo);
	}
	.st.added {
		background: var(--accent-soft);
		color: var(--accent-strong);
	}
	.st.deleted {
		background: var(--danger-soft);
		color: var(--danger);
	}
	.path {
		min-width: 0;
		overflow: hidden;
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 0.82rem;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--text-muted);
	}
	.icon-btn:hover {
		background: var(--danger-soft);
		color: var(--danger);
	}
	.diff {
		max-height: 60vh;
		overflow: auto;
		border-top: 1px solid var(--border);
		background: var(--bg);
		font-family: var(--font-mono);
		font-size: 0.76rem;
		line-height: 1.55;
	}
	.diff .empty {
		padding: 0.8rem;
	}
	.hunk-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.8rem;
		padding: 0.25rem 0.6rem;
		background: var(--surface-2);
		color: var(--text-muted);
	}
	.hunk-head .in {
		color: var(--text-2);
		font-weight: 600;
	}
	.ln {
		display: grid;
		grid-template-columns: 2.6rem 2.6rem 1.2rem 1fr;
	}
	.no {
		padding-right: 0.5rem;
		color: var(--text-faint);
		text-align: right;
		user-select: none;
	}
	.sign {
		color: var(--text-muted);
		user-select: none;
	}
	.ln code {
		white-space: pre-wrap;
		word-break: break-word;
	}
	.ln.add {
		background: color-mix(in oklab, var(--accent) 13%, transparent);
	}
	.ln.remove {
		background: color-mix(in oklab, var(--danger) 13%, transparent);
	}
	.commit {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.commit textarea {
		height: auto;
		padding: 0.6rem 0.8rem;
		font-family: var(--font-ui);
		resize: vertical;
	}
	.between {
		justify-content: space-between;
	}
	.hint {
		color: var(--text-muted);
		font-size: 0.78rem;
	}
	.auto {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
		color: var(--text-muted);
		font-size: 0.8rem;
	}
	.history {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.history li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.6rem;
		padding: 0.5rem 0;
	}
	.history li + li {
		border-top: 1px solid var(--border);
	}
	.oid {
		color: var(--accent);
		font-family: var(--font-mono);
		font-size: 0.78rem;
	}
	.msg {
		flex: 1;
		min-width: 12rem;
		font-size: 0.88rem;
	}
	.tag {
		padding: 0 0.4rem;
		border-radius: 999px;
		background: var(--todo-soft);
		color: var(--todo);
		font-size: 0.68rem;
		font-weight: 650;
	}
	.meta {
		color: var(--text-muted);
		font-size: 0.76rem;
	}
	@media (max-width: 720px) {
		.remote {
			margin-left: 0;
		}
		.ln {
			grid-template-columns: 2.2rem 1rem 1fr;
		}
		.no.old {
			display: none;
		}
		.files {
			margin-inline: -0.4rem;
		}
	}
</style>
