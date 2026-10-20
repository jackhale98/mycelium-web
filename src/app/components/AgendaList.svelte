<script lang="ts">
	import type { AgendaItem } from '$lib/vault/vault';
	import DateChip from '../org/DateChip.svelte';
	import TodoChip from '../org/TodoChip.svelte';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import { relativeDay, shortDate } from '../util';
	import Icon from './Icon.svelte';

	let {
		items,
		today,
		empty = 'Nothing here.',
		onTop,
	}: {
		items: AgendaItem[];
		today: string;
		empty?: string;
		/** Offer "only items under this top-level heading" (org's `^` filter). */
		onTop?: (item: AgendaItem) => void;
	} = $props();

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
</script>

{#if items.length === 0}
	<p class="empty">{empty}</p>
{:else}
	<ul class="agenda">
		{#each items as item (`${item.file}:${item.pos}`)}
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
					<a class="title" href={href.node(item.id ?? item.node?.id ?? '')}>
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
		{/each}
	</ul>
{/if}

<style>
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
	@media (max-width: 560px) {
		.item {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.end {
			grid-column: 2;
			justify-self: start;
		}
	}
</style>
