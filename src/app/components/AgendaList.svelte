<script lang="ts">
	import type { AgendaItem } from '$lib/vault/vault';
	import DateChip from '../org/DateChip.svelte';
	import HabitGraph from '../org/HabitGraph.svelte';
	import TodoChip from '../org/TodoChip.svelte';
	import { href } from '../router.svelte';
	import { app, localNow } from '../state.svelte';
	import { habitGraph, parseHabit } from '$lib/org';
	import { relativeDay, shortDate } from '../util';
	import Icon from './Icon.svelte';

	let {
		items,
		today,
		empty = 'Nothing here.',
		onTop,
		grid = false,
	}: {
		items: AgendaItem[];
		today: string;
		empty?: string;
		/** Offer "only items under this top-level heading" (org's `^` filter). */
		onTop?: (item: AgendaItem) => void;
		/** Today's time grid (org-agenda-time-grid): grid lines and the current time among timed items. */
		grid?: boolean;
	} = $props();

	/** org-agenda-time-grid's default times: 08:00 to 20:00, every two hours. */
	const GRID_TIMES = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];

	/** The time an item has today (a SCHEDULED or DEADLINE stamp with a time). */
	const timeToday = (item: AgendaItem) => {
		const due = item.deadline ?? item.scheduled;
		return due?.date === today && due.time ? due.time : null;
	};
	const timeLabel = (item: AgendaItem) => {
		const due = item.deadline ?? item.scheduled;
		return due?.time ? (due.endTime ? `${due.time}–${due.endTime}` : due.time) : null;
	};

	type Row =
		| { kind: 'grid' | 'now'; time: string; key: string }
		| { kind: 'item'; item: AgendaItem; time: string | null; key: string };

	let clock = $state(localNow().time);
	$effect(() => {
		if (!grid) return;
		const timer = setInterval(() => (clock = localNow().time), 60_000);
		return () => clearInterval(timer);
	});

	/**
	 * Timed items in time order with the grid and a "now" line between them
	 * (only when something has a time: `require-timed`), then the rest.
	 */
	const rows = $derived.by((): Row[] => {
		const plain = (item: AgendaItem): Row => ({
			kind: 'item',
			item,
			time: grid ? timeToday(item) && timeLabel(item) : null,
			key: `${item.file}:${item.pos}`,
		});
		if (!grid) return items.map(plain);
		const timed = items.filter((i) => timeToday(i));
		if (!timed.length) return items.map(plain);
		const order = { grid: 0, item: 1, now: 2 } as const;
		const line: Row[] = [
			...GRID_TIMES.map((time): Row => ({ kind: 'grid', time, key: `grid:${time}` })),
			...timed.map(plain),
			{ kind: 'now', time: clock, key: 'now' },
		];
		const at = (r: Row) => (r.kind === 'item' ? timeToday(r.item)! : r.time).padStart(5, '0');
		line.sort((a, b) => at(a).localeCompare(at(b)) || order[a.kind] - order[b.kind]);
		return [...line, ...items.filter((i) => !timeToday(i)).map(plain)];
	});

	/** A habit's consistency graph (org-habit), or `null` for other items. */
	function habitCells(item: AgendaItem) {
		void app.rev;
		const file = app.vault.file(item.file);
		if (!file || !item.scheduled?.repeater) return null;
		const h = parseHabit(file.source, item.pos, file.index.keywords);
		return h ? habitGraph(h, today) : null;
	}

	const keywordsFor = (file: string) => app.vault.file(file)?.index.keywords ?? app.vault.keywords;

	const edit = (item: AgendaItem) => (app.headingSheet = { path: item.file, pos: item.pos });

	// Touch: a long press on a row opens the heading sheet.
	let press: ReturnType<typeof setTimeout> | null = null;
	let pressed = false;
	function startPress(e: PointerEvent, item: AgendaItem) {
		if (e.pointerType !== 'touch') return;
		pressed = false;
		press = setTimeout(() => {
			pressed = true;
			navigator.vibrate?.(10);
			edit(item);
		}, 500);
	}
	function endPress() {
		if (press) clearTimeout(press);
		press = null;
	}

	/**
	 * Where the heading is in its file, as an org line-number search (`::42`),
	 * so a note opens scrolled to the entry rather than at its top.
	 */
	function lineAt(item: { file: string; pos: number }): string | null {
		const source = app.vault.file(item.file)?.source;
		if (!source) return null;
		let line = 1;
		for (let i = source.indexOf('\n'); i !== -1 && i < item.pos; i = source.indexOf('\n', i + 1))
			line += 1;
		return String(line);
	}
</script>

{#snippet itemRow(item: AgendaItem, time: string | null)}
	{@const due = item.deadline ?? item.scheduled}
	{@const overdue = !!due && due.date < today && !app.vault.isDone(item.todo, item.file)}
	<li
		class="item"
		class:done={app.vault.isDone(item.todo, item.file)}
		onpointerdown={(e) => startPress(e, item)}
		onpointerup={endPress}
		onpointercancel={endPress}
		onpointermove={endPress}
		onclickcapture={(e) => {
			// The long press already opened the sheet; don't also follow the link.
			if (pressed) {
				e.preventDefault();
				e.stopPropagation();
				pressed = false;
			}
		}}
	>
		<div class="kw-col">
			{#if item.todo}
				<TodoChip
					keyword={item.todo}
					config={keywordsFor(item.file)}
					onchange={(next) => app.setTodo(item.file, item.pos, next)}
				/>
			{/if}
		</div>
		<div class="main">
			{#if time}<span class="at">{time}</span>{/if}
			<a
				class="title"
				href={item.id
					? href.node(item.id)
					: item.node?.id
						? href.node(item.node.id, lineAt(item))
						: href.file(item.file, lineAt(item))}
			>
				{#if item.priority}<span class="prio">{item.priority}</span>{/if}{item.title}
			</a>
			<span class="where">
				{item.olp.length
					? item.olp.join(' › ')
					: (app.vault.fileNode(item.file)?.title ?? item.file)}
				{#each item.tags.filter((t) => item.id || !item.node?.tags.includes(t)) as tag (tag)}<span
						class="tag">#{tag}</span
					>{/each}
			</span>
			{#if habitCells(item)}
				{@const cells = habitCells(item)!}
				<button
					type="button"
					class="habit"
					aria-haspopup="dialog"
					aria-label={`Habit: done ${cells.filter((c) => c.done).length} of the last ${cells.length} days. Details`}
					onclick={() => (app.habitSheet = { path: item.file, pos: item.pos })}
					><HabitGraph {cells} {today} /></button
				>
			{/if}
		</div>
		<div class="end">
			{#if due}
				<DateChip
					path={item.file}
					offset={item.pos}
					kind={item.deadline ? 'DEADLINE' : 'SCHEDULED'}
					ts={due}
					compact
					{overdue}
					label={`${relativeDay(due.date, today)}${due.time ? ` · ${due.time}` : ''}`}
				/>
			{/if}
			{#if onTop}
				<button
					type="button"
					class="more"
					aria-label={`Only items under the top heading of “${item.title}”`}
					title="Only items under this top-level heading"
					onclick={() => onTop(item)}><Icon name="flag" size={14} /></button
				>
			{/if}
			<button
				type="button"
				class="more"
				aria-haspopup="dialog"
				aria-label={`Edit “${item.title}”`}
				title={`${shortDate(due?.date ?? today)} — edit heading`}
				onclick={() => edit(item)}><Icon name="settings" size={15} /></button
			>
		</div>
	</li>
{/snippet}

{#if items.length === 0}
	<p class="empty">{empty}</p>
{:else}
	<ul class="agenda">
		{#each rows as row (row.key)}
			{#if row.kind === 'grid'}
				<li class="grid-line" aria-hidden="true">
					<span class="gt">{row.time}</span><span class="rule"></span>
				</li>
			{:else if row.kind === 'now'}
				<li class="now-line"><span class="gt">{row.time}</span><span class="rule">now</span></li>
			{:else if row.kind === 'item'}
				{@render itemRow(row.item, row.time)}
			{/if}
		{/each}
	</ul>
{/if}

<style>
	.at {
		margin-right: 0.4rem;
		color: var(--accent);
		font-size: 0.82rem;
		font-variant-numeric: tabular-nums;
		font-weight: 650;
	}
	.grid-line,
	.now-line {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.15rem 0 0.15rem 0.2rem;
		color: var(--text-faint);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.grid-line .rule {
		flex: 1;
		border-top: 1px dashed var(--border);
	}
	.now-line {
		color: var(--todo);
		font-weight: 650;
	}
	.now-line .rule {
		flex: 1;
		padding-left: 0.4rem;
		border-top: 1.5px solid var(--todo);
		line-height: 0;
		text-transform: lowercase;
	}
	/* The habit's graph: its own line under the title, the whole row a button. */
	.habit {
		display: flex;
		width: 100%;
		margin: 0.4rem 0 0.1rem;
		padding: 0.2rem 0;
		border: 0;
		border-radius: 6px;
		background: none;
		cursor: pointer;
	}
	.habit:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.empty {
		margin: 0;
		padding: 0.9rem 0;
		color: var(--text-faint);
		font-size: 0.88rem;
	}
	.agenda {
		margin: 0;
		padding: 0;
		list-style: none;
		/* Rows stack by the list's own width (a phone, or a side panel). */
		container-type: inline-size;
	}
	.item {
		display: grid;
		grid-template-columns: 4.25rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 0.25rem;
		border-bottom: 1px solid var(--border);
	}
	.item:last-child {
		border-bottom: 0;
	}
	.kw-col {
		font-size: 1.15rem;
		line-height: 1;
	}
	.kw-col :global(.kw) {
		vertical-align: 0;
	}
	.main {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.title {
		overflow: hidden;
		color: var(--text);
		font-weight: 550;
		font-size: 0.92rem;
		text-decoration: none;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title:hover {
		color: var(--accent);
	}
	.done .title {
		color: var(--text-muted);
		text-decoration: line-through;
	}
	.prio {
		display: inline-grid;
		place-items: center;
		width: 1.15rem;
		height: 1.15rem;
		margin-right: 0.4rem;
		border: 1.5px solid var(--border-strong);
		border-radius: 50%;
		color: var(--text-muted);
		font-size: 0.6rem;
		font-weight: 700;
		vertical-align: 0.08rem;
	}
	.where {
		display: flex;
		gap: 0.45rem;
		overflow: hidden;
		color: var(--text-faint);
		font-size: 0.76rem;
		white-space: nowrap;
	}
	.tag {
		color: var(--text-faint);
	}
	.end {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}
	.more {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--text-faint);
	}
	.more:hover,
	.more:focus-visible {
		background: var(--surface-2);
		color: var(--accent);
	}
	@container (max-width: 35rem) {
		.item {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.end {
			grid-column: 2;
			justify-self: start;
		}
	}
</style>
