<script lang="ts">
	import AgendaList from '../components/AgendaList.svelte';
	import Icon from '../components/Icon.svelte';
	import { groupAgenda } from '../agenda';
	import { href } from '../router.svelte';
	import { describeTarget, templatePrompts } from '$lib/org';
	import { app, localNow } from '../state.svelte';
	import { addDays } from '$lib/org';
	import { longDate, relativeDay } from '../util';

	const today = localNow().date;
	/** A week since the last weekly review (or none yet, with tasks to review). */
	const reviewDue = $derived(!app.lastReview || app.lastReview <= addDays(today, -7));
	let draft = $state('');

	const agenda = $derived.by(() => {
		void app.rev;
		return groupAgenda(app.vault, today);
	});
	const attention = $derived(agenda.overdue.length + agenda.today.length);
	const focus = $derived([...agenda.overdue, ...agenda.today, ...agenda.upcoming].slice(0, 6));

	const recent = $derived.by(() => {
		void app.rev;
		return [...app.vault.files.values()]
			.filter((f) => !app.isDaily(f.path))
			.sort((a, b) => b.path.localeCompare(a.path))
			.map((f) => app.vault.fileNode(f.path))
			.filter((n) => n !== undefined)
			.slice(0, 6);
	});

	/** First line of body text, from the index (no parsing). */
	const excerpt = (file: string) => {
		const index = app.vault.file(file)?.index;
		if (!index) return '';
		const heads = new Set(index.headlines.map((h) => h.title));
		const line =
			index.text
				.split('\n')
				.slice(1)
				.find((l) => l.trim() && !heads.has(l)) ?? '';
		return line.replace(/\s+/g, ' ').trim().slice(0, 160);
	};

	const tags = $derived.by(() => {
		void app.rev;
		return [...app.vault.tags.entries()]
			.map(([tag, ids]) => ({ tag, count: ids.size }))
			.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
	});

	const hour = new Date().getHours();
	const greeting =
		hour < 5
			? 'Good night'
			: hour < 12
				? 'Good morning'
				: hour < 18
					? 'Good afternoon'
					: 'Good evening';

	const first = $derived(app.captureTemplates[0]);
	/** The first template opens the sheet when it needs more than the text (prompts, a title). */
	const quick = $derived(
		!!first && first.target.kind !== 'node' && templatePrompts(first.template).length === 0,
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!draft.trim()) return;
		if (!quick) return more();
		const result = app.capture(draft);
		if (!result) return;
		draft = '';
		app.captureNotice = { label: result.label, id: result.id, path: result.path };
	}

	function more() {
		app.captureSheet = { text: draft };
		draft = '';
	}

	$effect(() => {
		document.title = 'Home · Mycelium';
	});
</script>

<div class="home">
	<header class="hero">
		<p class="date">{longDate(today)}</p>
		<h1>{greeting}.</h1>
		<p class="stats">
			<strong>{app.vault.nodes.size}</strong> notes ·
			<strong>{[...app.vault.backlinks.values()].reduce((n, l) => n + l.length, 0)}</strong>
			links ·
			<strong>{attention}</strong>
			{attention === 1 ? 'task needs' : 'tasks need'} attention
		</p>
	</header>

	<form class="capture" onsubmit={submit} aria-label="Quick capture">
		<Icon name="feather" size={18} />
		<label class="sr-only" for="capture-input">Capture a thought to today's daily note</label>
		<input
			id="capture-input"
			bind:value={draft}
			placeholder="Capture a thought…"
			autocomplete="off"
			enterkeyhint="send"
		/>
		<span class="hint" aria-hidden="true"
			>{first ? `${first.name} → ${describeTarget(first.target)}` : ''} <kbd>↵</kbd></span
		>
		<button type="button" class="pick" aria-label="Capture with a template" onclick={more}
			><Icon name="chevronDown" size={16} /></button
		>
		<button type="submit" class="send" aria-label="Capture" disabled={!draft.trim()}
			><Icon name="arrowRight" size={16} /></button
		>
	</form>

	<nav class="plan" aria-label="Plan">
		<a href={href.triage()}
			><Icon name="feather" size={15} />Inbox<span class="n">{app.inbox.length}</span></a
		>
		<a href={href.review()} class:due={reviewDue}
			><Icon name="check" size={15} />Weekly review<span class="when"
				>{app.lastReview ? relativeDay(app.lastReview, today).toLowerCase() : 'not yet'}</span
			></a
		>
	</nav>

	<div class="grid">
		<section class="card focus" aria-labelledby="focus-h">
			<div class="card-head">
				<h2 id="focus-h">Up next</h2>
				<a class="more" href={href.agenda()}>Agenda <Icon name="chevronRight" size={14} /></a>
			</div>
			<AgendaList items={focus} {today} empty="You're all caught up." />
		</section>

		<section class="card daily" aria-labelledby="daily-h">
			<div class="card-head">
				<h2 id="daily-h">Daily notes</h2>
				<a class="more" href={href.dailies()}
					>All {app.dailies.length} <Icon name="chevronRight" size={14} /></a
				>
			</div>
			<ul class="days">
				{#each app.dailies.slice(0, 3) as date (date)}
					{@const node = app.vault.fileNode(app.dailyPath(date))}
					<li>
						<a href={href.daily(date)}>
							<span class="day-num">{date.slice(8)}</span>
							<span class="day-text">
								<span class="day-name"
									>{longDate(date).split(',')[0]}{date === today ? ' · Today' : ''}</span
								>
								<span class="day-sub">{node ? excerpt(node.file) || 'Empty' : ''}</span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	</div>

	<section class="recent" aria-labelledby="recent-h">
		<h2 id="recent-h" class="section-title">Recently added</h2>
		<ul class="cards">
			{#each recent as node (node.id)}
				<li>
					<a class="note-card" href={href.node(node.id)}>
						<span class="note-title">{node.title}</span>
						<span class="note-excerpt">{excerpt(node.file)}</span>
						<span class="note-tags"
							>{#each node.tags.slice(0, 3) as tag (tag)}<span>#{tag}</span>{/each}</span
						>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	<section class="tags" aria-labelledby="tags-h">
		<h2 id="tags-h" class="section-title">Tags</h2>
		<div class="tag-cloud">
			{#each tags as { tag, count } (tag)}
				<a href={href.tags(tag)} class="tag-pill">#{tag}<span>{count}</span></a>
			{/each}
		</div>
	</section>
</div>

<style>
	.home {
		max-width: 64rem;
		margin: 0 auto;
		padding: 3.5rem 3rem 6rem;
	}
	.hero .date {
		margin: 0 0 0.35rem;
		color: var(--accent);
		font-size: 0.8rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0;
		font-family: var(--font-read);
		font-size: clamp(2.2rem, 1.6rem + 2vw, 3.1rem);
		font-weight: 560;
		letter-spacing: -0.025em;
		line-height: 1.1;
	}
	.stats {
		margin: 0.7rem 0 0;
		color: var(--text-muted);
		font-size: 0.92rem;
	}
	.stats strong {
		color: var(--text);
		font-weight: 650;
	}
	.capture {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 2rem;
		padding: 0.45rem 0.45rem 0.45rem 1.1rem;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--surface);
		box-shadow: var(--shadow-md);
		color: var(--text-faint);
		transition:
			border-color 0.15s var(--ease),
			box-shadow 0.15s var(--ease);
	}
	.capture:focus-within {
		border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
		box-shadow:
			var(--shadow-md),
			0 0 0 4px color-mix(in oklab, var(--accent) 14%, transparent);
	}
	.capture input {
		flex: 1;
		min-width: 0;
		height: 2.6rem;
		border: 0;
		outline: 0;
		background: none;
		color: var(--text);
		font-size: 1rem;
	}
	.capture input::placeholder {
		color: var(--text-faint);
	}
	.hint {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		white-space: nowrap;
	}
	.pick {
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.6rem;
		border: 0;
		border-radius: 10px;
		background: none;
		color: var(--text-muted);
	}
	.pick:hover {
		background: var(--surface-2);
	}
	.send {
		display: grid;
		place-items: center;
		width: 2.6rem;
		height: 2.6rem;
		border: 0;
		border-radius: 10px;
		background: var(--accent);
		color: var(--on-accent);
		transition: opacity 0.15s var(--ease);
	}
	.send:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
		gap: 1.25rem;
		margin-top: 1.25rem;
	}
	.card {
		/* Task rows (which cover their swipe buttons) take the card's colour, not the page's. */
		--swipe-bg: var(--surface);
		padding: 1.1rem 1.25rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.25rem;
	}
	h2 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 650;
	}
	.more {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		color: var(--text-muted);
		font-size: 0.8rem;
		font-weight: 550;
		text-decoration: none;
	}
	.more:hover {
		color: var(--accent);
	}
	.days {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.days a {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.6rem 0.5rem;
		margin: 0 -0.5rem;
		border-radius: var(--radius);
		color: inherit;
		text-decoration: none;
	}
	.days a:hover {
		background: var(--surface-2);
	}
	.day-num {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		flex: none;
		border-radius: 10px;
		background: var(--accent-softer);
		color: var(--accent-strong);
		font-family: var(--font-read);
		font-size: 1.15rem;
		font-weight: 600;
		font-variant-numeric: lining-nums;
	}
	.day-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.day-name {
		font-weight: 600;
		font-size: 0.88rem;
	}
	.day-sub {
		overflow: hidden;
		color: var(--text-faint);
		font-size: 0.78rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.section-title {
		margin: 2.75rem 0 1rem;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.note-card {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		height: 100%;
		padding: 1.1rem 1.15rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		color: inherit;
		text-decoration: none;
		transition:
			border-color 0.15s var(--ease),
			transform 0.15s var(--ease),
			box-shadow 0.15s var(--ease);
	}
	.note-card:hover {
		border-color: var(--border-strong);
		box-shadow: var(--shadow-md);
		transform: translateY(-1px);
	}
	.note-title {
		font-family: var(--font-read);
		font-size: 1.2rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.note-excerpt {
		display: -webkit-box;
		flex: 1;
		overflow: hidden;
		color: var(--text-muted);
		font-size: 0.84rem;
		line-height: 1.5;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
	}
	.note-tags {
		display: flex;
		gap: 0.5rem;
		color: var(--accent);
		font-size: 0.74rem;
		font-weight: 550;
	}
	.tag-cloud {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}
	.tag-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		height: 2rem;
		padding: 0 0.4rem 0 0.8rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text-2);
		font-size: 0.82rem;
		font-weight: 550;
		text-decoration: none;
	}
	.tag-pill span {
		min-width: 1.35rem;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-muted);
		font-size: 0.7rem;
		text-align: center;
	}
	.tag-pill:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	@media (max-width: 900px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 720px) {
		.home {
			padding: 1.75rem 1rem 6rem;
		}
		.hint {
			display: none;
		}
	}
	.plan {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0.25rem 0 1.5rem;
	}
	.plan a {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2.5rem;
		padding: 0 0.9rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.88rem;
		font-weight: 600;
		text-decoration: none;
	}
	.plan a:hover {
		border-color: var(--accent);
	}
	.plan .n {
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 0.78rem;
	}
	.plan .when {
		color: var(--text-muted);
		font-weight: 500;
	}
	.plan a.due {
		border-color: var(--warn);
	}
	.plan a.due .when {
		color: var(--warn);
	}
</style>
