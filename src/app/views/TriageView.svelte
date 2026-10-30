<script lang="ts">
	// Processing the inbox, one thing at a time (the inbox is a file, set in
	// Settings → Tasks; its top-level headings are what's undecided, or the
	// sub-headings of a heading captures are filed under: see inbox.ts). Done,
	// Refile and Delete take a card out of the inbox; Schedule, State and
	// Later move on to the next and leave it where it is. Keys: d s t r x e,
	// space for later. Done and Delete can be undone from the bar.
	import { onMount } from 'svelte';
	import Icon, { type IconName } from '../components/Icon.svelte';
	import SwipeRow from '../components/SwipeRow.svelte';
	import TodoChip from '../org/TodoChip.svelte';
	import { href } from '../router.svelte';
	import { app, localNow, type InboxItem } from '../state.svelte';
	import { relativeDay } from '../util';

	const today = localNow().date;
	/** Cards put off for now (or decided but kept in the inbox), by their words. */
	let later = $state<string[]>([]);
	const key = (i: InboxItem) => `${i.title}\u0000${i.excerpt}`;

	const items = $derived(app.inbox);
	const queue = $derived(items.filter((i) => !later.includes(key(i))));
	const current = $derived(queue[0] ?? null);
	/** How many there were when this session started, for the progress line. */
	let start = $state(0);
	onMount(() => {
		start = app.inbox.length;
	});
	/** Taken out of the inbox this session (done, refiled, deleted). */
	const removed = $derived(Math.max(0, start - items.length));
	const putOff = $derived(items.length - queue.length);
	/** The card's own tags: not the ones every inbox heading gets from the file. */
	const ownTags = (i: InboxItem) => {
		const fileTags = app.vault.file(i.path)?.index.filetags ?? [];
		return i.tags.filter((t) => !fileTags.includes(t));
	};

	/** A sheet opened for the current card: move on once it changed something. */
	let pending: { key: string; before: string } | null = null;
	const stateOf = (i: InboxItem | undefined) =>
		i ? `${i.todo}|${i.scheduled?.raw ?? ''}|${i.priority}` : '';
	$effect(() => {
		const open = app.quickSheet || app.headingSheet;
		if (open || !pending) return;
		const p = pending;
		pending = null;
		const now = items.find((i) => key(i) === p.key);
		if (now && stateOf(now) !== p.before) later = [...later, p.key];
	});

	function laterOn(i: InboxItem) {
		later = [...later, key(i)];
	}
	function sheet(kind: 'schedule' | 'state', i: InboxItem) {
		pending = { key: key(i), before: stateOf(i) };
		app.quickSheet = { kind, path: i.path, pos: i.pos };
	}
	function edit(i: InboxItem) {
		pending = { key: key(i), before: stateOf(i) };
		app.headingSheet = { path: i.path, pos: i.pos };
	}

	type Action = { key: string; label: string; icon: IconName; run: (i: InboxItem) => void };
	const ACTIONS: Action[] = [
		{ key: 'd', label: 'Done', icon: 'check', run: (i) => app.completeTask(i.path, i.pos) },
		{ key: 's', label: 'Schedule', icon: 'calendar', run: (i) => sheet('schedule', i) },
		{ key: 't', label: 'State', icon: 'list', run: (i) => sheet('state', i) },
		{
			key: 'r',
			label: 'Refile',
			icon: 'arrowRight',
			run: (i) => (app.refileSheet = { path: i.path, pos: i.pos }),
		},
		{ key: 'x', label: 'Delete', icon: 'trash', run: (i) => app.deleteHeading(i.path, i.pos) },
		{ key: ' ', label: 'Later', icon: 'chevronRight', run: laterOn },
	];

	function onkeydown(e: KeyboardEvent) {
		if (!current || e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target as HTMLElement;
		if (
			t.closest('input, textarea, select, [contenteditable], dialog') ||
			document.querySelector('dialog[open]')
		)
			return;
		const action = ACTIONS.find((a) => a.key === e.key.toLowerCase());
		if (e.key === 'e') {
			e.preventDefault();
			return edit(current);
		}
		if (!action) return;
		e.preventDefault();
		action.run(current);
	}
</script>

<svelte:window {onkeydown} />

<div class="triage">
	<header>
		<p class="eyebrow">Inbox</p>
		<h1>Process the inbox</h1>
		{#if items.length || removed}
			<p class="progress" role="status">
				{[
					queue.length ? `${queue.length} to go` : '',
					removed ? `${removed} done` : '',
					putOff ? `${putOff} for later` : '',
				]
					.filter(Boolean)
					.join(' · ')}
			</p>
		{/if}
	</header>

	{#if !app.inboxPath}
		<div class="empty">
			<p>
				There's no inbox file yet. Choose one in <a href={href.settings('tasks')}
					>Settings → Tasks</a
				>, or create <code>inbox.org</code> and point a capture template at it: its top-level headings
				are what's waiting to be decided.
			</p>
		</div>
	{:else if current}
		{#key key(current)}
			<SwipeRow
				main={{
					label: 'Done',
					icon: 'check',
					run: () => app.completeTask(current.path, current.pos),
				}}
			>
				<article class="card" aria-labelledby="triage-title">
					{#if current.todo || current.priority}<div class="top">
							{#if current.todo}
								<TodoChip
									keyword={current.todo}
									config={app.vault.file(current.path)?.index.keywords ?? app.vault.keywords}
									onchange={(next) => app.setTodo(current.path, current.pos, next)}
								/>
							{/if}
							{#if current.priority}<span class="prio">#{current.priority}</span>{/if}
						</div>{/if}
					<h2 id="triage-title">{current.title}</h2>
					{#if ownTags(current).length || current.scheduled || current.deadline}
						<p class="meta">
							{#if current.deadline}<span class="due"
									><Icon name="alert" size={13} />Due {relativeDay(
										current.deadline.date,
										today,
									)}</span
								>{/if}
							{#if current.scheduled}<span
									><Icon name="calendar" size={13} />{relativeDay(
										current.scheduled.date,
										today,
									)}</span
								>{/if}
							{#each ownTags(current) as t (t)}<span class="tag">#{t}</span>{/each}
						</p>
					{/if}
					{#if current.excerpt}<p class="excerpt">{current.excerpt}</p>{/if}
				</article>
			</SwipeRow>
		{/key}
		<div class="actions" role="group" aria-label="Decide">
			{#each ACTIONS as a (a.label)}
				<button
					type="button"
					class="act"
					class:primary={a.label === 'Done'}
					class:danger={a.label === 'Delete'}
					onclick={() => a.run(current)}
					aria-keyshortcuts={a.key === ' ' ? 'Space' : a.key}
					><Icon name={a.icon} size={18} /><span>{a.label}</span><kbd aria-hidden="true"
						>{a.key === ' ' ? 'space' : a.key}</kbd
					></button
				>
			{/each}
		</div>
		<button type="button" class="link" onclick={() => edit(current)}
			>Edit everything <kbd aria-hidden="true">e</kbd></button
		>
	{:else if items.length}
		<div class="empty">
			<p class="big">You've been through everything.</p>
			<p>
				{items.length}
				{items.length === 1 ? 'thing stays' : 'things stay'} in the inbox for later.
			</p>
			<button type="button" class="btn" onclick={() => (later = [])}>Go through them again</button>
		</div>
	{:else}
		<div class="empty zero">
			<p class="big"><Icon name="check" size={22} /> Inbox zero</p>
			<p>Everything has a place.</p>
			<p class="links">
				<a class="btn primary" href={href.review()}>Weekly review</a>
				<a class="btn" href={href.agenda()}>Agenda</a>
			</p>
		</div>
	{/if}
</div>

<style>
	.triage {
		max-width: 38rem;
		margin: 0 auto;
		padding: 3.25rem 2rem 6rem;
	}
	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0;
		font-family: var(--font-read);
		font-size: 2.2rem;
		font-weight: 600;
	}
	.progress {
		margin: 0.4rem 0 0;
		color: var(--text-muted);
	}
	header {
		margin-bottom: 1.5rem;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 10rem;
		padding: 1.25rem 1.35rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-md);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 1.5rem;
	}
	.prio {
		color: var(--todo);
		font-weight: 700;
	}
	h2 {
		margin: 0;
		font-size: 1.35rem;
		line-height: 1.3;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.8rem;
		margin: 0;
		color: var(--text-2);
		font-size: 0.86rem;
	}
	.meta span {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.meta .due {
		color: var(--danger);
	}
	.tag {
		color: var(--text-muted);
	}
	.excerpt {
		margin: 0.25rem 0 0;
		color: var(--text-2);
		white-space: pre-line;
	}
	.actions {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.act {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-height: 4.25rem;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.86rem;
		font-weight: 650;
	}
	.act:hover {
		border-color: var(--accent);
	}
	.act.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
	}
	.act.danger {
		color: var(--danger);
	}
	.act kbd {
		position: absolute;
		top: 0.35rem;
		right: 0.5rem;
		color: inherit;
		font-size: 0.66rem;
		opacity: 0.55;
	}
	.link {
		display: block;
		margin: 0.75rem auto 0;
		border: 0;
		background: none;
		color: var(--text-muted);
		font-size: 0.86rem;
		text-decoration: underline;
	}
	.empty {
		padding: 2rem 1.25rem;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-lg);
		color: var(--text-2);
		text-align: center;
	}
	.empty .big {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		color: var(--text);
		font-size: 1.25rem;
		font-weight: 650;
	}
	.zero .big {
		color: var(--accent);
	}
	.links {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
	}
	@media (pointer: coarse) {
		.act kbd,
		.link kbd {
			display: none;
		}
	}
	@media (max-width: 720px) {
		.triage {
			padding: 1.75rem 1rem 6rem;
		}
		h1 {
			font-size: 1.8rem;
		}
	}
</style>
