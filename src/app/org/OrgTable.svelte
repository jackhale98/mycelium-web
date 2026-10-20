<script lang="ts">
	import {
		analyseTable,
		plainText,
		startOf,
		tableAffiliated,
		type OrgNode,
		type TableRow,
	} from '$lib/org';
	import { app } from '../state.svelte';
	import Inline from './OrgInline.svelte';
	import type { RenderContext } from './context';

	type Cell = { type: 'table-cell'; children: OrgNode[] };
	type Row = { type: 'table-row'; rowType: 'standard' | 'rule'; children: Cell[] };

	let { node, ctx }: { node: OrgNode & { children: Row[] }; ctx: RenderContext } = $props();

	const rows = $derived(node.children);
	const layout = $derived(
		analyseTable(
			rows.map((r): TableRow =>
				r.rowType === 'rule'
					? { rule: true }
					: { cells: r.children.map((c) => plainText(c.children)) },
			),
		),
	);

	// Caption and name sit just above the table, as #+CAPTION: / #+NAME: lines.
	const affiliated = $derived.by(() => {
		if (!ctx.interactive) return { caption: null, name: null };
		const source = app.vault.file(ctx.path)?.source;
		const first = rows[0];
		if (!source || !first) return { caption: null, name: null };
		// Read backwards from the first row (positions are into the file's source).
		const begin = startOf(first as unknown as OrgNode);
		return tableAffiliated(source.slice(Math.max(0, begin - 2000), begin));
	});

	const cells = (i: number) => rows[i]!.children;
	const alignClass = (k: number) => `a-${layout.align[k]}`;
	const style = (k: number) => {
		const w = layout.width[k];
		return w ? `max-width: ${w}ch` : undefined;
	};
</script>

<!-- Scrollable tables must be reachable by keyboard. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="table-wrap" role="region" aria-label={affiliated.caption ?? 'Table'} tabindex="0">
	<table id={affiliated.name ?? undefined}>
		{#if affiliated.caption}<caption>{affiliated.caption}</caption>{/if}
		{#if layout.colGroups.some(Boolean)}
			<colgroup>
				{#each layout.columns as _, k (k)}
					<col class={layout.colGroups[k] ? `g-${layout.colGroups[k]}` : undefined} />
				{/each}
			</colgroup>
		{/if}
		{#if layout.head.length}
			<thead>
				{#each layout.head as i (i)}
					<tr>
						{#each layout.columns as c, k (c)}
							{@const cell = cells(i)[c]}
							<th scope="col" class={alignClass(k)} style={style(k)}
								>{#if cell}<Inline nodes={cell.children} {ctx} />{/if}</th
							>
						{/each}
					</tr>
				{/each}
			</thead>
		{/if}
		{#each layout.groups as group, g (g)}
			<tbody class:split={g > 0}>
				{#each group as i (i)}
					<tr>
						{#each layout.columns as c, k (c)}
							{@const cell = cells(i)[c]}
							<td class={alignClass(k)} style={style(k)}
								>{#if cell}<Inline nodes={cell.children} {ctx} />{/if}</td
							>
						{/each}
					</tr>
				{/each}
			</tbody>
		{/each}
	</table>
</div>

<style>
	caption {
		padding: 0.6rem 0.85rem 0.5rem;
		caption-side: top;
		color: var(--text-muted);
		font-family: var(--font-ui);
		font-size: 0.82rem;
		font-weight: 600;
		text-align: left;
	}
	.a-right {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.a-center {
		text-align: center;
	}
	.a-left {
		text-align: left;
	}
	td,
	th {
		overflow-wrap: anywhere;
	}
	tbody.split {
		border-top: 2px solid var(--border-strong);
	}
	col.g-start {
		border-left: 2px solid var(--border-strong);
	}
	col.g-end {
		border-right: 2px solid var(--border-strong);
	}
	col.g-both {
		border-right: 2px solid var(--border-strong);
		border-left: 2px solid var(--border-strong);
	}
	thead th {
		position: sticky;
		top: 0;
		z-index: 1;
	}
</style>
