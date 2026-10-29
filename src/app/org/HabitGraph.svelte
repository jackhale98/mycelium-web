<script lang="ts">
	// org-habit's consistency graph in the app's colours: a cell per day,
	// filled where it was done, tinted by org's faces otherwise (not due yet,
	// may be done, last day, late), paler for days to come; today is
	// ringed. In a row it fits its line: a narrow list shows 14 days back and
	// 7 ahead, a wide one all 28. The full variant is a 4-week grid with dates.
	import type { HabitCell } from '$lib/org';

	let {
		cells,
		today,
		full = false,
	}: { cells: HabitCell[]; today: string; full?: boolean } = $props();

	const describe = (c: HabitCell) =>
		`${new Date(`${c.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${c.done ? ': done' : ''}`;
</script>

<span class="graph" class:full aria-hidden="true">
	{#each cells as c, i (c.date)}
		<span
			class={`cell ${c.face}`}
			class:done={c.done}
			class:future={c.future && !c.done}
			class:today={c.date === today}
			class:old={i < cells.length - 21}
			title={describe(c)}
			>{#if full}{Number(c.date.slice(8))}{/if}</span
		>
	{/each}
</span>

<style>
	.graph {
		display: flex;
		gap: 2px;
		width: 100%;
		max-width: 34rem;
	}
	.cell {
		flex: 1 1 0;
		min-width: 0;
		height: 0.85rem;
		border-radius: 3px;
		background: var(--surface-3);
	}
	.cell.ready {
		background: var(--accent-soft);
	}
	.cell.alert {
		background: var(--warn-soft);
	}
	.cell.overdue {
		background: var(--danger-soft);
	}
	.cell.done {
		background: var(--accent);
		color: var(--on-accent);
	}
	/* Days to come: only the window when it may be done is tinted (org paints
	   them late too, which reads as an error before it's happened). */
	.cell.future {
		opacity: 0.55;
	}
	.cell.future.alert,
	.cell.future.overdue {
		background: var(--surface-3);
	}
	.cell.today {
		outline: 2px solid var(--text);
		outline-offset: 1px;
	}
	/* A narrow list (the agenda list is a size container): the last two weeks and the next. */
	@container (max-width: 35rem) {
		.graph:not(.full) .old {
			display: none;
		}
	}
	.full {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 4px;
		max-width: none;
	}
	.full .cell {
		display: grid;
		place-items: center;
		height: 2.4rem;
		border-radius: 8px;
		color: var(--text-2);
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.full .cell.done {
		color: var(--on-accent);
	}
</style>
