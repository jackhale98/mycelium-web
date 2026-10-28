<script lang="ts">
	// Tasks as a board: a column per TODO state of the workflow, rows by tag,
	// category or file if wanted. Moving a card changes its TODO keyword (with
	// org's logging, repeaters and [n/m] counts), by its Move menu or by
	// dragging. Cards sort by priority, then due date: org has no order of
	// its own for them, and none is written into the notes.
	import type { AgendaItem } from '$lib/vault/vault';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import { relativeDay } from '../util';
	import Icon from './Icon.svelte';

	let {
		keep,
		today,
		categoryLabels = {},
	}: {
		keep: (item: AgendaItem) => boolean;
		today: string;
		categoryLabels?: Record<string, string>;
	} = $props();

	type Rows = 'none' | 'tag' | 'category' | 'file';
	const ROWS_KEY = 'mycelium:board-rows';
	let rows = $state<Rows>(
		(() => {
			try {
				const r = localStorage.getItem(ROWS_KEY);
				return r === 'tag' || r === 'category' || r === 'file' ? r : 'none';
			} catch {
				return 'none';
			}
		})(),
	);
	function setRows(r: Rows) {
		rows = r;
		try {
			localStorage.setItem(ROWS_KEY, r);
		} catch {
			// Not remembered: fine.
		}
	}

	const OTHER = '';
	/** Done columns show the most recently closed few. */
	const DONE_LIMIT = 12;

	const keywords = $derived(app.vault.keywords);
	const columns = $derived([...keywords.todoKeywords, ...keywords.doneKeywords]);
	const isDone = (k: string) => keywords.doneKeywords.includes(k);

	const items = $derived.by(() => {
		void app.rev;
		return app.vault.agenda().filter((i) => i.todo && keep(i));
	});
	const hasOther = $derived(items.some((i) => !columns.includes(i.todo!)));
	const shown = $derived(hasOther ? [...columns, OTHER] : columns);

	const PRIORITY = (p: string | null) => (p ? p.charCodeAt(0) : 1000);
	const due = (i: AgendaItem) => (i.deadline ?? i.scheduled)?.date ?? '9999';
	function sortCards(list: AgendaItem[], column: string): AgendaItem[] {
		if (column !== OTHER && isDone(column))
			return list
				.sort((a, b) => (b.closed?.date ?? '').localeCompare(a.closed?.date ?? ''))
				.slice(0, DONE_LIMIT);
		return list.sort(
			(a, b) =>
				PRIORITY(a.priority) - PRIORITY(b.priority) ||
				due(a).localeCompare(due(b)) ||
				a.title.localeCompare(b.title),
		);
	}

	const fileTitle = (path: string) => app.vault.file(path)?.index.title || path;
	/** The rows an item belongs to (by tag: one per tag). */
	function rowKeys(i: AgendaItem): string[] {
		if (rows === 'tag') return i.tags.length ? i.tags : [''];
		if (rows === 'category') return [categoryLabels[i.category] ?? i.category];
		if (rows === 'file') return [fileTitle(i.file)];
		return [''];
	}

	const board = $derived.by(() => {
		const byRow = new Map<string, Map<string, AgendaItem[]>>();
		const totals = new Map<string, number>();
		for (const i of items) {
			const col = columns.includes(i.todo!) ? i.todo! : OTHER;
			totals.set(col, (totals.get(col) ?? 0) + 1);
			for (const r of rowKeys(i)) {
				const row = byRow.get(r) ?? new Map<string, AgendaItem[]>();
				byRow.set(r, row);
				row.set(col, [...(row.get(col) ?? []), i]);
			}
		}
		const names = [...byRow.keys()].sort((a, b) =>
			a === '' ? 1 : b === '' ? -1 : a.localeCompare(b),
		);
		return {
			totals,
			rows: names.map((name) => ({
				name,
				cells: shown.map((col) => ({
					col,
					cards: sortCards(byRow.get(name)!.get(col) ?? [], col),
				})),
			})),
		};
	});
	const rowLabel = (name: string) =>
		name ||
		(rows === 'tag' ? 'No tag' : rows === 'category' ? 'No category' : rows === 'file' ? '' : '');

	/** Where a card opens: its note, at its heading. */
	function cardHref(i: AgendaItem): string {
		if (i.id) return href.node(i.id);
		const source = app.vault.file(i.file)?.source ?? '';
		let line = 1;
		for (let n = source.indexOf('\n'); n !== -1 && n < i.pos; n = source.indexOf('\n', n + 1))
			line += 1;
		return i.node ? href.node(i.node.id, String(line)) : href.file(i.file, String(line));
	}

	function move(i: AgendaItem, to: string) {
		if (!to || to === i.todo) return;
		app.setTodo(i.file, i.pos, to);
	}

	let dragging = $state<AgendaItem | null>(null);
	let over = $state<string | null>(null);
	const plain = (title: string) => title.replace(/<[^>]*>/g, '').trim() || title;
</script>

<div class="board-view">
	<div class="board-tools">
		<label class="rows">
			<span>Rows</span>
			<select class="input" value={rows} onchange={(e) => setRows(e.currentTarget.value as Rows)}>
				<option value="none">None</option>
				<option value="tag">By tag</option>
				<option value="category">By category</option>
				<option value="file">By note</option>
			</select>
		</label>
		<span class="hint">Drag a card, or use its menu, to change its state.</span>
	</div>

	<div class="scroller">
		<div class="board" style:--cols={shown.length}>
			{#each shown as col (col)}
				<h2 class="col-head" class:done={col !== OTHER && isDone(col)}>
					{col || 'Other'}<span class="count">{board.totals.get(col) ?? 0}</span>
				</h2>
			{/each}
			{#each board.rows as row (row.name)}
				{#if rows !== 'none'}
					<h3 class="row-head">{rowLabel(row.name)}</h3>
				{/if}
				{#each row.cells as cell (cell.col)}
					{@const target = `${row.name}\u0000${cell.col}`}
					<ul
						class="cell"
						class:over={over === target}
						aria-label={`${cell.col || 'Other'}${rows !== 'none' ? `, ${rowLabel(row.name)}` : ''}`}
						ondragover={(e) => {
							if (!dragging || cell.col === OTHER) return;
							e.preventDefault();
							over = target;
						}}
						ondragleave={() => over === target && (over = null)}
						ondrop={(e) => {
							e.preventDefault();
							const card = dragging;
							dragging = null;
							over = null;
							if (card && cell.col !== OTHER) move(card, cell.col);
						}}
					>
						{#each cell.cards as card (`${card.file}:${card.pos}`)}
							<li
								class="card"
								draggable="true"
								data-file={card.file}
								data-pos={card.pos}
								ondragstart={(e) => {
									// Which card, from the element itself.
									const el = e.currentTarget as HTMLElement;
									dragging =
										items.find(
											(i) => i.file === el.dataset.file && String(i.pos) === el.dataset.pos,
										) ?? null;
									e.dataTransfer?.setData('text/plain', dragging?.title ?? '');
								}}
								ondragend={() => {
									dragging = null;
									over = null;
								}}
							>
								<a class="title" href={cardHref(card)}
									>{#if card.priority}<span class="prio">#{card.priority}</span>{/if}{plain(
										card.title,
									)}</a
								>
								<span class="where">{card.node?.title ?? fileTitle(card.file)}</span>
								{#if card.deadline || card.scheduled || card.tags.length}
									<span class="meta">
										{#if card.deadline}<span class="when" class:late={card.deadline.date < today}
												><Icon name="alert" size={11} />{relativeDay(
													card.deadline.date,
													today,
												)}</span
											>{:else if card.scheduled}<span class="when"
												><Icon name="calendar" size={11} />{relativeDay(
													card.scheduled.date,
													today,
												)}</span
											>{/if}
										{#each card.tags.slice(0, 3) as t (t)}<span class="tag">#{t}</span>{/each}
									</span>
								{/if}
								<select
									class="move"
									aria-label={`Move “${plain(card.title)}” to`}
									value={card.todo}
									onchange={(e) => move(card, e.currentTarget.value)}
								>
									{#each columns as k (k)}<option value={k}>{k}</option>{/each}
									{#if !columns.includes(card.todo!)}<option value={card.todo}>{card.todo}</option
										>{/if}
								</select>
							</li>
						{/each}
					</ul>
				{/each}
			{/each}
		</div>
	</div>
	{#if !items.length}
		<p class="hint">No tasks with a TODO keyword match the filters.</p>
	{/if}
</div>

<style>
	.board-view {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}
	.board-tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
	}
	.rows {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.rows .input {
		width: auto;
	}
	.hint {
		margin: 0;
		color: var(--text-faint);
		font-size: 0.8rem;
	}
	.scroller {
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scroll-snap-type: x proximity;
		padding-bottom: 0.5rem;
	}
	.board {
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(14rem, 1fr));
		gap: 0.5rem;
		min-width: min-content;
	}
	.col-head {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		padding: 0.4rem 0.6rem;
		border-radius: 8px;
		background: var(--surface-2);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		scroll-snap-align: start;
	}
	.col-head.done {
		color: var(--text-muted);
	}
	.count {
		margin-left: auto;
		color: var(--text-faint);
		font-weight: 650;
	}
	.row-head {
		grid-column: 1 / -1;
		margin: 0.5rem 0 0;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border);
		color: var(--text-2);
		font-size: 0.86rem;
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-height: 3rem;
		margin: 0;
		padding: 0.3rem;
		border-radius: 10px;
		list-style: none;
	}
	.cell.over {
		background: var(--accent-soft);
		outline: 2px dashed var(--accent);
		outline-offset: -2px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		box-shadow: var(--shadow-sm);
		cursor: grab;
	}
	.title {
		color: var(--text);
		font-size: 0.88rem;
		font-weight: 600;
		line-height: 1.35;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.title:hover {
		color: var(--link);
	}
	.prio {
		margin-right: 0.3rem;
		color: var(--todo);
		font-size: 0.75rem;
	}
	.where {
		color: var(--text-muted);
		font-size: 0.75rem;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.5rem;
		font-size: 0.72rem;
	}
	.when {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		color: var(--text-2);
	}
	.when.late {
		color: var(--danger);
	}
	.tag {
		color: var(--text-muted);
	}
	.move {
		align-self: flex-start;
		margin-top: 0.15rem;
		padding: 0.15rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--bg);
		color: var(--text-2);
		font-size: 0.72rem;
	}
	@media (pointer: coarse) {
		.move {
			min-height: 2.25rem;
			font-size: 16px;
		}
	}
	/* Phones: one column at a time, swiping between them. */
	@media (max-width: 720px) {
		.board {
			grid-template-columns: repeat(var(--cols), 82vw);
		}
		.cell {
			scroll-snap-align: start;
		}
	}
</style>
