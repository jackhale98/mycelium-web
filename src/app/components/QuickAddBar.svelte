<script lang="ts">
	// "Add a task…" on the agenda: one line in plain language, Enter, done.
	// It goes where the Task template puts tasks (the first template that
	// reads quick adds; the built-in one if none does), with what it
	// understood shown as chips while typing.
	import { DEFAULT_CAPTURE_TEMPLATES, type CaptureTemplate } from '$lib/org';
	import { app, localNow } from '../state.svelte';
	import Icon from './Icon.svelte';
	import QuickAddChips from './QuickAddChips.svelte';

	let text = $state('');
	/** Room for the example in the hint, or just "Add a task…" (a phone). */
	let roomy = $state(true);
	$effect(() => {
		const mq = window.matchMedia('(min-width: 600px)');
		const set = () => (roomy = mq.matches);
		set();
		mq.addEventListener('change', set);
		return () => mq.removeEventListener('change', set);
	});
	let keep = $state<string[]>([]);
	let input: HTMLInputElement | undefined = $state();

	const template = $derived<CaptureTemplate>(
		app.captureTemplates.find((t) => t.parse && t.type === 'entry') ??
			DEFAULT_CAPTURE_TEMPLATES.find((t) => t.id === 'task')!,
	);
	const today = $derived.by(() => {
		void app.rev;
		return localNow().date;
	});
	const quick = $derived(text.trim() ? app.quickAdd(text, keep) : null);

	function add(e: SubmitEvent) {
		e.preventDefault();
		if (!quick?.title) return;
		const result = app.captureWith(template, { text, keep: [...keep] });
		if (!result) return;
		app.captureNotice = { label: result.label, id: result.id, path: result.path };
		text = '';
		keep = [];
		input?.focus();
	}
</script>

<form class="quick-add" onsubmit={add}>
	<label class="qa-field">
		<Icon name="plus" size={16} />
		<span class="sr-only">Add a task</span>
		<input
			bind:this={input}
			bind:value={text}
			placeholder={roomy
				? 'Add a task… “Call Sam tomorrow 3pm #work”'
				: 'Add a task… “Call Sam 3pm”'}
			autocomplete="off"
			enterkeyhint="done"
		/>
		{#if text.trim()}
			<button type="submit" class="btn small primary" disabled={!quick?.title}>Add</button>
		{/if}
	</label>
	{#if quick}
		<QuickAddChips q={quick} {today} onkeep={(words) => (keep = [...keep, words])} />
	{/if}
</form>

<style>
	.quick-add {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		margin: -0.5rem 0 1.25rem;
	}
	.qa-field {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-height: 2.75rem;
		padding: 0 0.4rem 0 0.8rem;
		border: 1px dashed var(--border-strong);
		border-radius: 12px;
		background: var(--surface);
		color: var(--text-muted);
	}
	.qa-field:focus-within {
		border-style: solid;
		border-color: var(--accent);
	}
	input {
		flex: 1;
		min-width: 0;
		text-overflow: ellipsis;
		padding: 0.55rem 0;
		border: 0;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 0.95rem;
	}
	input:focus {
		outline: none;
	}
</style>
