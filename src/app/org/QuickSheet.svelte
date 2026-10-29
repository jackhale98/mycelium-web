<script lang="ts">
	// A small sheet of choices for one heading, opened from a swipe:
	// - schedule: Today, Tomorrow, the weekend, next week, a date of your
	//   choosing, or none (its time and repeater stay);
	// - state: the file's TODO keywords, or none;
	// - priority: A, B, C or none.
	// Each choice applies at once, with an Undo in the bar, and closes it.
	import { addDays } from '$lib/org';
	import { fitKeyboard } from '../actions/fit-keyboard';
	import { sheetGestures } from '../actions/sheet-gestures';
	import Icon from '../components/Icon.svelte';
	import { app, localNow } from '../state.svelte';
	import { shortDate } from '../util';

	let dialog: HTMLDialogElement | undefined = $state();
	let returnFocus: HTMLElement | null = null;

	const target = $derived(app.quickSheet);
	const h = $derived(target ? app.heading(target.path, target.pos) : null);
	const today = $derived.by(() => {
		void app.rev;
		return localNow().date;
	});
	const TITLES = { schedule: 'Schedule', state: 'State', priority: 'Priority' } as const;

	$effect(() => {
		if (!dialog) return;
		if (target && !dialog.open) {
			returnFocus = document.activeElement as HTMLElement | null;
			dialog.showModal();
		} else if (!target && dialog.open) dialog.close();
	});
	$effect(() => {
		if (target && !h) app.quickSheet = null;
	});

	const close = () => (app.quickSheet = null);

	/** Days from today to the next `weekday` (0 Sunday … 6 Saturday), after today. */
	function nextWeekday(weekday: number): string {
		const d = new Date(`${today}T12:00`).getDay();
		return addDays(today, (weekday - d + 7) % 7 || 7);
	}
	const days = $derived([
		{ label: 'Today', date: today },
		{ label: 'Tomorrow', date: addDays(today, 1) },
		{ label: 'This weekend', date: nextWeekday(6) },
		{ label: 'Next week', date: nextWeekday(1) },
	]);

	function schedule(date: string | null, label: string) {
		if (!target) return;
		app.scheduleTask(target.path, target.pos, date, label);
		close();
	}
	function setState(keyword: string | null) {
		if (!target) return;
		if (keyword !== (h?.todo ?? null)) app.setTodoUndoable(target.path, target.pos, keyword);
		close();
	}
	function setPriority(p: string | null) {
		if (!target) return;
		if (p !== (h?.priority ?? null)) app.setPriority(target.path, target.pos, p);
		close();
	}
</script>

<dialog
	use:fitKeyboard
	use:sheetGestures
	bind:this={dialog}
	class="sheet"
	aria-labelledby="qs-title"
	onclose={() => {
		app.quickSheet = null;
		returnFocus?.focus?.();
	}}
	onclick={(e) => e.target === dialog && close()}
>
	{#if target && h}
		<div class="body">
			<div class="grip" aria-hidden="true"></div>
			<header>
				<div>
					<h2 id="qs-title">{TITLES[target.kind]}</h2>
					<p class="what">{h.title}</p>
				</div>
				<button type="button" class="x" aria-label="Close" onclick={close}
					><Icon name="close" size={16} /></button
				>
			</header>

			{#if target.kind === 'schedule'}
				<ul class="choices">
					{#each days as d (d.label)}
						<li>
							<button
								type="button"
								class:current={h.scheduled?.date === d.date}
								onclick={() => schedule(d.date, d.label)}
								><span>{d.label}</span><span class="hint">{shortDate(d.date)}</span></button
							>
						</li>
					{/each}
					<li>
						<label class="pick">
							<span>Pick a date…</span>
							<input
								type="date"
								class="input"
								value={h.scheduled?.date ?? ''}
								onchange={(e) =>
									e.currentTarget.value &&
									schedule(e.currentTarget.value, shortDate(e.currentTarget.value))}
							/>
						</label>
					</li>
					{#if h.scheduled}
						<li>
							<button type="button" class="remove" onclick={() => schedule(null, 'Unscheduled')}
								><span>No schedule</span><span class="hint">was {shortDate(h.scheduled.date)}</span
								></button
							>
						</li>
					{/if}
				</ul>
			{:else if target.kind === 'state'}
				<ul class="choices">
					{#each [...h.keywords.todoKeywords, ...h.keywords.doneKeywords] as k (k)}
						<li>
							<button type="button" class:current={h.todo === k} onclick={() => setState(k)}
								><span class="kw">{k}</span>{#if h.keywords.doneKeywords.includes(k)}<span
										class="hint">done</span
									>{/if}</button
							>
						</li>
					{/each}
					<li>
						<button type="button" class:current={!h.todo} onclick={() => setState(null)}
							><span>No state</span><span class="hint">a plain heading</span></button
						>
					</li>
				</ul>
			{:else}
				<ul class="choices">
					{#each ['A', 'B', 'C'] as p (p)}
						<li>
							<button type="button" class:current={h.priority === p} onclick={() => setPriority(p)}
								><span class="kw">#{p}</span></button
							>
						</li>
					{/each}
					<li>
						<button type="button" class:current={!h.priority} onclick={() => setPriority(null)}
							><span>No priority</span></button
						>
					</li>
				</ul>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		width: min(24rem, calc(100vw - 2rem));
		max-height: min(85dvh, 40rem);
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
		gap: 0.75rem;
		padding: 1rem 1.25rem 1.25rem;
	}
	.grip {
		display: none;
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}
	h2 {
		margin: 0;
		font-size: 1.05rem;
	}
	.what {
		margin: 0.15rem 0 0;
		color: var(--text-muted);
		font-size: 0.85rem;
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
	.choices {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.choices button,
	.pick {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		min-height: 3rem;
		padding: 0 0.9rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--bg);
		color: var(--text);
		font-size: 0.95rem;
		font-weight: 600;
		text-align: left;
	}
	.choices button.current {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.choices button.remove {
		color: var(--danger);
	}
	.hint {
		color: var(--text-muted);
		font-size: 0.82rem;
		font-weight: 500;
	}
	.kw {
		letter-spacing: 0.04em;
	}
	.pick .input {
		width: auto;
	}
	@media (max-width: 720px) {
		.sheet {
			width: 100%;
			max-width: 100%;
			max-height: min(88dvh, calc(var(--vvh, 100dvh) - 0.75rem));
			margin: auto 0 var(--kb, 0px);
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
	}
	@keyframes up {
		from {
			transform: translateY(40%);
			opacity: 0.4;
		}
	}
</style>
