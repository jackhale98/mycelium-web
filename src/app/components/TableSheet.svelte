<script lang="ts">
	// Edit an org table as a grid of fields (a sheet from the bottom on
	// phones): text boxes instead of space-padded text, so narrow screens and
	// on-screen keyboards work. The first column stays in view while the grid
	// scrolls sideways; for wide tables, "One row" shows a row as a short form
	// labelled by the header. Saving writes the table back aligned exactly
	// as org-table-align would.
	import { tick } from 'svelte';
	import {
		cleanCell,
		deleteColumn,
		deleteRow,
		insertColumn,
		insertRow,
		insertRule,
		moveColumn,
		moveRow,
		tableAt,
		type TableRow,
	} from '$lib/org';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	let dialog: HTMLDialogElement | undefined = $state();
	let grid: HTMLDivElement | undefined = $state();

	type Edit = { path: string; offset: number; before: string; done?: () => void };
	let editing = $state<Edit | null>(null);
	let rows = $state<TableRow[]>([]);
	let sel = $state({ row: 0, col: 0 });
	let mode = $state<'grid' | 'row'>('grid');
	let error = $state<string | null>(null);

	const sheet = $derived(app.tableSheet);
	const columns = $derived(Math.max(1, ...rows.flatMap((r) => (r.rule ? [] : [r.cells.length]))));
	const hasHeader = $derived(rows.length > 1 && !rows[0]!.rule && !!rows[1]!.rule);
	const dataRows = $derived(rows.flatMap((r, i) => (r.rule ? [] : [i])));
	const label = (c: number) =>
		(hasHeader && !rows[0]!.rule ? rows[0]!.cells[c]?.trim() : '') || `Column ${c + 1}`;

	$effect(() => {
		if (!dialog) return;
		if (sheet && !dialog.open) open(sheet);
		else if (!sheet && dialog.open) dialog.close();
	});

	function open(s: { path: string; offset: number; done?: () => void }) {
		const file = app.vault.file(s.path);
		const t = file && tableAt(file.source, s.offset);
		if (!file || !t) {
			app.tableSheet = null;
			return;
		}
		editing = {
			path: s.path,
			offset: s.offset,
			before: file.source.slice(t.from, t.to),
			...(s.done ? { done: s.done } : {}),
		};
		rows = t.rows.map((r) => (r.rule ? { rule: true } : { cells: [...r.cells] }));
		const first = rows.findIndex((r, i) => !r.rule && !(i === 0 && rows[1]?.rule));
		sel = { row: first === -1 ? 0 : first, col: 0 };
		mode = 'grid';
		error = null;
		dialog!.showModal();
		void focusCell();
	}

	function close() {
		const done = editing?.done;
		app.tableSheet = null;
		editing = null;
		// After the dialog has gone (and the keyboard with it): show the table again.
		if (done) requestAnimationFrame(() => requestAnimationFrame(done));
	}

	function save() {
		if (!editing) return;
		const clean = rows.map((r) => (r.rule ? r : { cells: r.cells.map(cleanCell) }));
		if (app.replaceTable(editing.path, editing.offset, editing.before, clean)) close();
		else error = 'This table changed while you were editing it (a sync, or another editor).';
	}

	async function focusCell() {
		await tick();
		const el = (mode === 'grid' ? grid : dialog)?.querySelector<HTMLInputElement>(
			mode === 'grid'
				? `input[data-r="${sel.row}"][data-c="${sel.col}"]`
				: `input[data-c="${sel.col}"]`,
		);
		el?.focus();
		el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	const setCell = (r: number, c: number, value: string) => {
		const row = rows[r];
		if (!row || row.rule) return;
		const cells = [...row.cells];
		while (cells.length < columns) cells.push('');
		cells[c] = value;
		rows[r] = { cells };
	};

	/** Enter in a field: the same field one row down (a new row at the end), as in org. */
	function down(r: number, c: number) {
		let next = r + 1;
		while (next < rows.length && rows[next]!.rule) next += 1;
		if (next >= rows.length) {
			rows = insertRow(rows, rows.length);
			next = rows.length - 1;
		}
		sel = { row: next, col: c };
		void focusCell();
	}

	// Row and column tools act on the selected field.
	function act(kind: string) {
		const { row, col } = sel;
		switch (kind) {
			case 'row-add':
				rows = insertRow(rows, row + 1);
				sel = { row: row + 1, col };
				break;
			case 'row-del':
				if (dataRows.length <= 1) return;
				rows = deleteRow(rows, row);
				sel = { row: Math.min(row, rows.length - 1), col };
				if (rows[sel.row]?.rule) sel = { row: Math.max(0, sel.row - 1), col };
				break;
			case 'row-up':
				if (row <= 0) return;
				rows = moveRow(rows, row, -1);
				sel = { row: row - 1, col };
				break;
			case 'row-down':
				if (row >= rows.length - 1) return;
				rows = moveRow(rows, row, 1);
				sel = { row: row + 1, col };
				break;
			case 'col-add':
				rows = insertColumn(rows, col + 1);
				sel = { row, col: col + 1 };
				break;
			case 'col-del':
				if (columns <= 1) return;
				rows = deleteColumn(rows, col);
				sel = { row, col: Math.min(col, columns - 2) };
				break;
			case 'col-left':
				if (col <= 0) return;
				rows = moveColumn(rows, col, -1);
				sel = { row, col: col - 1 };
				break;
			case 'col-right':
				if (col >= columns - 1) return;
				rows = moveColumn(rows, col, 1);
				sel = { row, col: col + 1 };
				break;
			case 'header':
				if (hasHeader) rows = deleteRow(rows, 1);
				else rows = insertRule(rows, 1);
				break;
		}
		void focusCell();
	}

	/** In "One row" mode: step through the rows that hold data. */
	function step(by: -1 | 1) {
		const i = dataRows.indexOf(sel.row);
		const next = dataRows[i + by];
		if (next !== undefined) sel = { row: next, col: sel.col };
		void focusCell();
	}

	const keep = (e: Event) => e.preventDefault();
</script>

<dialog
	bind:this={dialog}
	class="sheet"
	aria-labelledby="table-title"
	onclose={close}
	onclick={(e) => e.target === dialog && close()}
>
	{#if editing}
		<div class="body">
			<header>
				<h2 id="table-title">Edit table</h2>
				<div class="views" role="radiogroup" aria-label="View">
					<button
						type="button"
						role="radio"
						aria-checked={mode === 'grid'}
						onclick={() => {
							mode = 'grid';
							void focusCell();
						}}>Grid</button
					>
					<button
						type="button"
						role="radio"
						aria-checked={mode === 'row'}
						onclick={() => {
							mode = 'row';
							void focusCell();
						}}>One row</button
					>
				</div>
				<button type="button" class="x" aria-label="Close without saving" onclick={close}
					><Icon name="close" size={16} /></button
				>
			</header>

			<div class="tools" role="toolbar" aria-label="Rows and columns">
				<span class="group" role="group" aria-label="Row">
					<span class="what">Row</span>
					<button
						type="button"
						onmousedown={keep}
						onclick={() => act('row-up')}
						aria-label="Move row up"><Icon name="arrowUp" size={15} /></button
					>
					<button
						type="button"
						onmousedown={keep}
						onclick={() => act('row-down')}
						aria-label="Move row down"><Icon name="arrowDown" size={15} /></button
					>
					<button
						type="button"
						onmousedown={keep}
						onclick={() => act('row-add')}
						aria-label="Add row below"><Icon name="plus" size={15} /></button
					>
					<button
						type="button"
						onmousedown={keep}
						onclick={() => act('row-del')}
						aria-label="Delete row"><Icon name="trash" size={15} /></button
					>
				</span>
				<span class="group" role="group" aria-label="Column">
					<span class="what">Column</span>
					<button
						type="button"
						onmousedown={keep}
						onclick={() => act('col-left')}
						aria-label="Move column left"><Icon name="chevronLeft" size={15} /></button
					>
					<button
						type="button"
						onmousedown={keep}
						onclick={() => act('col-right')}
						aria-label="Move column right"><Icon name="chevronRight" size={15} /></button
					>
					<button
						type="button"
						onmousedown={keep}
						onclick={() => act('col-add')}
						aria-label="Add column to the right"><Icon name="plus" size={15} /></button
					>
					<button
						type="button"
						onmousedown={keep}
						onclick={() => act('col-del')}
						aria-label="Delete column"><Icon name="trash" size={15} /></button
					>
				</span>
				<label class="header-toggle">
					<input type="checkbox" checked={hasHeader} onchange={() => act('header')} />
					Header row
				</label>
			</div>

			{#if mode === 'grid'}
				<div class="grid" bind:this={grid}>
					<table>
						<tbody>
							{#each rows as row, r (r)}
								{#if row.rule}
									<tr class="rule" aria-hidden="true"><td colspan={columns}></td></tr>
								{:else}
									<tr class:head={hasHeader && r === 0}>
										{#each { length: columns } as _, c (c)}
											<td class:sel={sel.row === r && sel.col === c}>
												<input
													data-r={r}
													data-c={c}
													value={row.cells[c] ?? ''}
													aria-label={hasHeader && r === 0
														? `Header, column ${c + 1}`
														: `Row ${dataRows.indexOf(r) + (hasHeader ? 0 : 1)}, ${label(c)}`}
													enterkeyhint="next"
													onfocus={() => (sel = { row: r, col: c })}
													oninput={(e) => setCell(r, c, e.currentTarget.value)}
													onkeydown={(e) => {
														if (e.key === 'Enter') {
															e.preventDefault();
															down(r, c);
														}
													}}
												/>
											</td>
										{/each}
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				{@const row = rows[sel.row]}
				<div class="form">
					<div class="stepper">
						<button
							type="button"
							class="btn small"
							disabled={dataRows.indexOf(sel.row) <= 0}
							onclick={() => step(-1)}><Icon name="chevronLeft" size={14} />Previous</button
						>
						<span class="where"
							>{hasHeader && sel.row === 0
								? 'Header'
								: `Row ${dataRows.indexOf(sel.row) + (hasHeader ? 0 : 1)} of ${dataRows.length - (hasHeader ? 1 : 0)}`}</span
						>
						<button
							type="button"
							class="btn small"
							onclick={() =>
								dataRows.indexOf(sel.row) >= dataRows.length - 1 ? down(sel.row, sel.col) : step(1)}
							>{dataRows.indexOf(sel.row) >= dataRows.length - 1 ? 'New row' : 'Next'}<Icon
								name="chevronRight"
								size={14}
							/></button
						>
					</div>
					{#if row && !row.rule}
						{#each { length: columns } as _, c (c)}
							<label class="field">
								<span>{label(c)}</span>
								<input
									class="input"
									data-c={c}
									value={row.cells[c] ?? ''}
									onfocus={() => (sel = { row: sel.row, col: c })}
									oninput={(e) => setCell(sel.row, c, e.currentTarget.value)}
								/>
							</label>
						{/each}
					{/if}
				</div>
			{/if}

			{#if error}<p class="notice warn" role="alert">{error}</p>{/if}
			<footer>
				<button type="button" class="btn" onclick={close}>Cancel</button>
				<button type="button" class="btn primary" onclick={save}>Save table</button>
			</footer>
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		width: min(52rem, calc(100vw - 2rem));
		max-height: min(88dvh, 48rem);
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 18px;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	.sheet::backdrop {
		background: rgb(20 18 12 / 0.4);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		max-height: inherit;
		padding: 1rem 1.25rem 1.25rem;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	h2 {
		flex: 1;
		margin: 0;
		font-size: 1.02rem;
	}
	.views {
		display: flex;
		padding: 2px;
		border: 1px solid var(--border);
		border-radius: 9px;
	}
	.views button {
		padding: 0.3rem 0.65rem;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--text-muted);
		font-size: 0.82rem;
		font-weight: 600;
	}
	.views button[aria-checked='true'] {
		background: var(--accent-soft);
		color: var(--text);
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
	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.9rem;
	}
	.group {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}
	.what {
		margin-right: 0.25rem;
		color: var(--text-muted);
		font-size: 0.75rem;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.group button {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text-2);
	}
	.group button:hover {
		background: var(--surface-2);
	}
	.header-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
	}
	.grid {
		min-height: 8rem;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overscroll-behavior: contain;
	}
	table {
		border-collapse: separate;
		border-spacing: 0;
	}
	td {
		padding: 0;
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	/* The first column stays in view while the grid scrolls sideways. */
	td:first-child {
		position: sticky;
		left: 0;
		z-index: 1;
		box-shadow: 1px 0 0 var(--border-strong);
	}
	tr.head td {
		background: var(--surface-2);
	}
	tr.head input {
		font-weight: 650;
	}
	tr.rule td {
		height: 3px;
		background: var(--border-strong);
	}
	td.sel {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	td input {
		width: 9rem;
		min-width: 6rem;
		padding: 0.55rem 0.6rem;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: 0.92rem;
		outline: none;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		overflow-y: auto;
	}
	.stepper {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.where {
		color: var(--text-muted);
		font-size: 0.85rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.82rem;
		font-weight: 600;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	@media (max-width: 720px) {
		.sheet {
			width: 100%;
			max-width: 100%;
			max-height: 92dvh;
			margin: auto 0 0;
			border-radius: 20px 20px 0 0;
		}
		.body {
			padding: 0.9rem 1rem calc(1rem + env(safe-area-inset-bottom));
		}
		td input {
			width: 8rem;
		}
	}
</style>
