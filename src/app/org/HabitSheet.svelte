<script lang="ts">
	// A habit's details: its 4-week graph, streak and completion rate, the
	// rhythm in words, and a button to mark today done (org's repeater moves
	// it on and logs the completion, which is where the graph reads it from).
	import { habitGraph, habitRhythm, habitStats, parseHabit, type Habit } from '$lib/org';
	import { sheetGestures } from '../actions/sheet-gestures';
	import Icon from '../components/Icon.svelte';
	import { app, localNow } from '../state.svelte';
	import { relativeDay } from '../util';
	import HabitGraph from './HabitGraph.svelte';

	let dialog: HTMLDialogElement | undefined = $state();
	let returnFocus: HTMLElement | null = null;

	const target = $derived(app.habitSheet);
	const today = $derived.by(() => {
		void app.rev;
		return localNow().date;
	});
	const h = $derived(target ? app.heading(target.path, target.pos) : null);
	const habit = $derived.by((): Habit | null => {
		void app.rev;
		if (!target) return null;
		const file = app.vault.file(target.path);
		return file ? parseHabit(file.source, target.pos, file.index.keywords) : null;
	});
	const cells = $derived(habit ? habitGraph(habit, today) : []);
	const stats = $derived(habit ? habitStats(habit, today) : null);
	const doneToday = $derived(cells.some((c) => c.date === today && c.done));
	const fileTitle = $derived(
		target ? (app.vault.file(target.path)?.index.title ?? target.path) : '',
	);
	const RHYTHM_FROM: Record<Habit['type'], string> = {
		'.+': 'counted from when it was last done',
		'++': 'on a steady rhythm, skipping missed ones',
		'+': 'on fixed dates',
	};
	// Monday to Sunday, but the grid starts 21 days before today: name its columns.
	const columns = $derived(
		cells
			.slice(0, 7)
			.map((c) => new Date(`${c.date}T12:00`).toLocaleDateString(undefined, { weekday: 'narrow' })),
	);

	$effect(() => {
		if (!dialog) return;
		if (target && !dialog.open) {
			returnFocus = document.activeElement as HTMLElement | null;
			dialog.showModal();
		} else if (!target && dialog.open) dialog.close();
	});
	// Not a habit (any more), or the heading went away: close.
	$effect(() => {
		if (target && (!h || !habit)) app.habitSheet = null;
	});

	const close = () => (app.habitSheet = null);
	function markDone() {
		if (!target || !h) return;
		const done = h.keywords.doneKeywords[0];
		if (done) app.setTodo(target.path, target.pos, done);
	}
	function edit() {
		if (!target) return;
		const t = target;
		close();
		app.headingSheet = t;
	}
</script>

<dialog
	use:sheetGestures
	bind:this={dialog}
	class="sheet"
	aria-labelledby="habit-title"
	onclose={() => {
		app.habitSheet = null;
		returnFocus?.focus?.();
	}}
	onclick={(e) => e.target === dialog && close()}
>
	{#if target && h && habit && stats}
		<div class="body">
			<div class="grip" aria-hidden="true"></div>
			<header>
				<p class="where"><Icon name="file" size={13} />{fileTitle}</p>
				<button type="button" class="x" aria-label="Close" onclick={close}
					><Icon name="close" size={16} /></button
				>
			</header>
			<h2 id="habit-title">{h.title}</h2>
			<p class="rhythm">{habitRhythm(habit)}, {RHYTHM_FROM[habit.type]}</p>

			<dl class="stats">
				<div>
					<dt>Streak</dt>
					<dd>{stats.streak}</dd>
				</div>
				<div>
					<dt>Last 4 weeks</dt>
					<dd>{Math.round(stats.rate * 100)}%<small>{stats.done} of {stats.expected}</small></dd>
				</div>
				<div>
					<dt>Last done</dt>
					<dd class="small">{stats.lastDone ? relativeDay(stats.lastDone, today) : 'Not yet'}</dd>
				</div>
			</dl>

			<section aria-label={`Last 3 weeks and the next: done ${stats.done} times`}>
				<div class="cols" aria-hidden="true">
					{#each columns as c, i (i)}<span>{c}</span>{/each}
				</div>
				<HabitGraph {cells} {today} full />
				<ul class="legend" aria-hidden="true">
					<li><i class="k done"></i>Done</li>
					<li><i class="k ready"></i>Due</li>
					<li><i class="k alert"></i>Last day</li>
					<li><i class="k overdue"></i>Late</li>
				</ul>
			</section>

			<footer>
				<button type="button" class="btn" onclick={edit}
					><Icon name="settings" size={15} />Edit heading</button
				>
				<button type="button" class="btn primary" disabled={doneToday} onclick={markDone}
					><Icon name="check" size={15} />{doneToday ? 'Done today' : 'Mark done today'}</button
				>
			</footer>
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		width: min(30rem, calc(100vw - 2rem));
		max-height: min(88dvh, 44rem);
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 18px;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
		overscroll-behavior: contain;
	}
	.sheet::backdrop {
		background: rgb(20 18 12 / 0.4);
		backdrop-filter: blur(3px);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1rem 1.25rem 1.25rem;
	}
	.grip {
		display: none;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.where {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		color: var(--text-muted);
		font-size: 0.8rem;
		font-weight: 550;
	}
	.x {
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text-muted);
	}
	h2 {
		margin: -0.4rem 0 0;
		font-family: var(--font-read);
		font-size: 1.4rem;
	}
	.rhythm {
		margin: -0.6rem 0 0;
		color: var(--text-muted);
		font-size: 0.88rem;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0;
	}
	.stats div {
		padding: 0.6rem 0.75rem;
		border-radius: 12px;
		background: var(--surface-2);
	}
	dt {
		color: var(--text-muted);
		font-size: 0.72rem;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	dd {
		margin: 0.15rem 0 0;
		font-size: 1.5rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	dd.small {
		font-size: 1rem;
		line-height: 2.2rem;
	}
	dd small {
		display: block;
		color: var(--text-muted);
		font-size: 0.75rem;
		font-weight: 550;
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		margin-bottom: 0.3rem;
		color: var(--text-faint);
		font-size: 0.72rem;
		font-weight: 650;
		text-align: center;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
		margin: 0.6rem 0 0;
		padding: 0;
		color: var(--text-muted);
		font-size: 0.78rem;
		list-style: none;
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.k {
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 3px;
	}
	.k.done {
		background: var(--accent);
	}
	.k.ready {
		background: var(--accent-soft);
	}
	.k.alert {
		background: var(--warn-soft);
	}
	.k.overdue {
		background: var(--danger-soft);
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	@media (max-width: 720px) {
		.sheet {
			width: 100%;
			max-width: 100%;
			margin: auto 0 0;
			border-width: 1px 0 0;
			border-radius: 20px 20px 0 0;
			animation: up 0.22s var(--ease);
		}
		.body {
			padding: 0.5rem 1rem calc(1rem + env(safe-area-inset-bottom));
		}
		.grip {
			display: block;
			width: 2.5rem;
			height: 4px;
			margin: 0.2rem auto 0;
			border-radius: 999px;
			background: var(--border-strong);
		}
		footer .btn {
			flex: 1;
		}
	}
	@keyframes up {
		from {
			transform: translateY(40%);
			opacity: 0.4;
		}
	}
</style>
