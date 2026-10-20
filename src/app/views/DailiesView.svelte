<script lang="ts">
	import Icon from '../components/Icon.svelte';
	import { href, router } from '../router.svelte';
	import { app, localNow } from '../state.svelte';

	const today = localNow().date;
	const MONTHS_PER_PAGE = 6;
	let pages = $state(1);
	let filter = $state('');
	let jump = $state(today);

	interface Day {
		date: string;
		summary: string;
		tasks: number;
		open: number;
		words: number;
	}

	/** Cheap per-day summary from the index (no parsing): first lines and task counts. */
	const days = $derived.by((): Day[] => {
		void app.rev;
		return app.dailies.map((date) => {
			const file = app.vault.file(app.dailyPath(date));
			const index = file?.index;
			const lines = (index?.text ?? '')
				.split('\n')
				.slice(1)
				.filter((l) => l.trim());
			const tasks = index?.headlines.filter((h) => h.todo) ?? [];
			return {
				date,
				summary: lines.slice(0, 2).join(' · '),
				tasks: tasks.length,
				open: tasks.filter((h) => !app.vault.isDone(h.todo, file?.path)).length,
				words: (index?.text ?? '').split(/\s+/).filter(Boolean).length,
			};
		});
	});

	const shown = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		if (!q) return days;
		return days.filter(
			(d) =>
				d.date.includes(q) ||
				(app.vault.file(app.dailyPath(d.date))?.source.toLowerCase().includes(q) ?? false),
		);
	});

	const months = $derived.by(() => {
		const groups = new Map<string, Day[]>();
		for (const d of shown) {
			const key = d.date.slice(0, 7);
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(d);
		}
		return [...groups.entries()];
	});
	const visible = $derived(months.slice(0, pages * MONTHS_PER_PAGE));

	const monthName = (key: string) =>
		new Date(`${key}-01T12:00:00`).toLocaleDateString(undefined, {
			month: 'long',
			year: 'numeric',
		});
	const weekday = (date: string) =>
		new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });

	/** Calendar cells for a month, Monday first; `null` pads the first week. */
	function grid(key: string): (string | null)[] {
		const [y, m] = key.split('-').map(Number) as [number, number];
		const first = new Date(y, m - 1, 1);
		const lead = (first.getDay() + 6) % 7;
		const count = new Date(y, m, 0).getDate();
		const cells: (string | null)[] = Array.from({ length: lead }, () => null);
		for (let d = 1; d <= count; d++) cells.push(`${key}-${String(d).padStart(2, '0')}`);
		return cells;
	}

	function go(e: Event) {
		e.preventDefault();
		if (/^\d{4}-\d{2}-\d{2}$/.test(jump)) router.go(href.daily(jump));
	}

	$effect(() => {
		document.title = 'Dailies · Mycelium';
	});
</script>

<div class="page wide">
	<div class="head">
		<div>
			<h1>Dailies</h1>
			<p class="lede">
				{days.length}
				{days.length === 1 ? 'daily note' : 'daily notes'} in
				<code>{app.layout.dailyDir || '.'}/</code>
			</p>
		</div>
		<a class="btn primary" href={href.daily(today)}><Icon name="calendar" size={15} />Today</a>
	</div>

	<div class="tools">
		<form class="jump" onsubmit={go}>
			<label for="jump-date">Go to</label>
			<input id="jump-date" class="input" type="date" bind:value={jump} />
			<button class="btn small">Open</button>
		</form>
		<label class="find">
			<Icon name="search" size={14} />
			<span class="sr-only">Filter dailies</span>
			<input type="search" placeholder="Filter by text or date" bind:value={filter} />
		</label>
	</div>

	{#if shown.length === 0}
		<p class="empty">
			{days.length ? 'No daily note matches.' : 'No daily notes yet — open Today to start one.'}
		</p>
	{/if}

	{#each visible as [key, list] (key)}
		{@const have = new Set(list.map((d) => d.date))}
		<section class="month" aria-labelledby={`m-${key}`}>
			<h2 id={`m-${key}`}>{monthName(key)} <span class="n">{list.length}</span></h2>
			<div class="layout">
				<div class="cal" aria-hidden="true">
					{#each ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as d, i (i)}<span class="dow">{d}</span>{/each}
					{#each grid(key) as cell, i (i)}
						{#if !cell}<span></span>
						{:else if have.has(cell)}
							<a class="day has" class:today={cell === today} href={href.daily(cell)} tabindex="-1"
								>{Number(cell.slice(8))}</a
							>
						{:else}
							<span class="day" class:today={cell === today}>{Number(cell.slice(8))}</span>
						{/if}
					{/each}
				</div>
				<ol class="entries">
					{#each list as d (d.date)}
						<li>
							<a href={href.daily(d.date)}>
								<span class="date"
									><span class="num">{d.date.slice(8)}</span><span class="wd"
										>{weekday(d.date)}</span
									></span
								>
								<span class="body">
									<span class="summary">{d.summary || 'Empty'}</span>
									<span class="meta">
										{#if d.date === today}<span class="pill today">Today</span>{/if}
										{#if d.open}<span class="pill open">{d.open} open</span>{/if}
										{#if d.tasks - d.open}<span class="pill done">{d.tasks - d.open} done</span
											>{/if}
										<span>{d.words} words</span>
									</span>
								</span>
							</a>
						</li>
					{/each}
				</ol>
			</div>
		</section>
	{/each}

	{#if months.length > visible.length}
		<button type="button" class="btn more" onclick={() => (pages += 1)}>Show older months</button>
	{/if}
</div>

<style>
	.wide {
		max-width: 56rem;
	}
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
	}
	.head h1 {
		margin: 0 0 0.4rem;
		font-family: var(--font-read);
		font-size: 2.4rem;
		font-weight: 600;
		letter-spacing: -0.022em;
	}
	.head .lede {
		margin: 0;
		color: var(--text-muted);
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin: 1.75rem 0 2rem;
	}
	.jump {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.jump .input {
		width: auto;
		height: 2.2rem;
	}
	.find {
		display: flex;
		flex: 1;
		min-width: 12rem;
		align-items: center;
		gap: 0.5rem;
		height: 2.2rem;
		padding: 0 0.75rem;
		border: 1px solid var(--border-strong);
		border-radius: 10px;
		background: var(--surface);
		color: var(--text-muted);
	}
	.find input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		color: var(--text);
		outline: none;
	}
	.empty {
		color: var(--text-muted);
	}
	.month + .month {
		margin-top: 2.25rem;
	}
	.month h2 {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0 0 0.9rem;
		font-family: var(--font-read);
		font-size: 1.35rem;
		font-weight: 600;
	}
	.n {
		color: var(--text-faint);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		font-weight: 550;
	}
	.layout {
		display: grid;
		grid-template-columns: 13rem minmax(0, 1fr);
		align-items: start;
		gap: 1.5rem;
	}
	.cal {
		position: sticky;
		top: 1rem;
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 3px;
		padding: 0.7rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		font-size: 0.72rem;
		text-align: center;
	}
	.dow {
		color: var(--text-faint);
		font-weight: 650;
	}
	.day {
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		border-radius: 6px;
		color: var(--text-faint);
		text-decoration: none;
	}
	.day.has {
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-weight: 700;
	}
	.day.has:hover {
		background: var(--accent);
		color: var(--on-accent);
	}
	.day.today {
		box-shadow: inset 0 0 0 1.5px var(--ring, #b8862a);
	}
	.entries {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.entries a {
		display: flex;
		gap: 1rem;
		padding: 0.7rem 0.8rem;
		border-radius: 10px;
		color: var(--text);
		text-decoration: none;
	}
	.entries a:hover {
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	.date {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 2.6rem;
		flex: none;
	}
	.num {
		font-family: var(--font-read);
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.1;
	}
	.wd {
		color: var(--text-muted);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}
	.summary {
		display: -webkit-box;
		overflow: hidden;
		color: var(--text-2);
		font-family: var(--font-read);
		font-size: 1rem;
		line-height: 1.45;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		color: var(--text-faint);
		font-size: 0.72rem;
	}
	.pill {
		padding: 0 0.45rem;
		border-radius: 999px;
		font-weight: 650;
		line-height: 1.35rem;
	}
	.pill.open {
		background: var(--todo-soft);
		color: var(--todo);
	}
	.pill.done {
		background: var(--done-soft);
		color: var(--done);
	}
	.pill.today {
		background: var(--accent-soft);
		color: var(--accent-strong);
	}
	.more {
		display: flex;
		margin: 2rem auto 0;
	}
	@media (max-width: 720px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
		.cal {
			display: none;
		}
	}
</style>
