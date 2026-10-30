<script lang="ts">
	// "Link to…": choose the note a link goes to (or make one), starting from
	// the words being linked. The words stay as the link's text; the caller
	// says what to do with the choice.
	import { matchRank } from '../editor/match';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	let dialog: HTMLDialogElement | undefined = $state();
	let query = $state('');
	let active = $state(0);
	const uid = $props.id();

	$effect(() => {
		if (!dialog) return;
		if (app.linkPicker && !dialog.open) {
			query = app.linkPicker.query;
			active = 0;
			dialog.showModal();
		} else if (!app.linkPicker && dialog.open) dialog.close();
	});

	const clean = $derived(query.replace(/\s+/g, ' ').trim());
	type Option = { kind: 'note'; id: string; title: string; detail: string } | { kind: 'new' };
	const options = $derived.by((): Option[] => {
		void app.rev;
		const best = new Map<string, { rank: number; title: string; detail: string }>();
		for (const node of app.vault.nodes.values()) {
			for (const name of [node.title, ...node.aliases]) {
				const rank = matchRank(name, clean);
				if (rank === null) continue;
				const had = best.get(node.id);
				if (had && had.rank <= rank) continue;
				const detail =
					name === node.title ? node.olp.join(' › ') : `${name} is an alias of ${node.title}`;
				best.set(node.id, { rank, title: node.title, detail });
			}
		}
		const notes = [...best.entries()]
			.sort(
				([, a], [, b]) =>
					a.rank - b.rank || a.title.length - b.title.length || a.title.localeCompare(b.title),
			)
			.slice(0, 30)
			.map(([id, b]): Option => ({ kind: 'note', id, title: b.title, detail: b.detail }));
		const exact = clean && app.vault.titles.has(clean.toLowerCase());
		return clean && !exact ? [...notes, { kind: 'new' }] : notes;
	});
	$effect(() => {
		void options;
		if (active >= options.length) active = Math.max(0, options.length - 1);
	});

	function choose(option: Option | undefined) {
		const picker = app.linkPicker;
		if (!picker || !option) return;
		if (option.kind === 'new') {
			const id = app.createNode(clean);
			app.linkPicker = null;
			if (id) picker.pick(id, clean);
			return;
		}
		app.linkPicker = null;
		picker.pick(option.id, option.title);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const n = options.length;
			if (n) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
			document.getElementById(`${uid}-o${active}`)?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'Enter') {
			e.preventDefault();
			choose(options[active]);
		}
	}
</script>

<dialog
	bind:this={dialog}
	class="link-picker"
	aria-labelledby={`${uid}-h`}
	onclose={() => {
		const picker = app.linkPicker;
		app.linkPicker = null;
		picker?.cancel?.();
	}}
>
	<div class="body">
		<h2 id={`${uid}-h`}>
			Link {#if app.linkPicker?.words}“{app.linkPicker.words}”{/if} to…
		</h2>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="input"
			role="combobox"
			aria-label="Note to link to"
			aria-expanded="true"
			aria-controls={`${uid}-list`}
			aria-activedescendant={options.length ? `${uid}-o${active}` : undefined}
			aria-autocomplete="list"
			autocomplete="off"
			spellcheck="false"
			bind:value={query}
			oninput={() => (active = 0)}
			onkeydown={onKey}
			autofocus
		/>
		<ul id={`${uid}-list`} role="listbox" aria-label="Notes">
			{#each options as option, n (option.kind === 'note' ? option.id : '+new')}
				<li
					id={`${uid}-o${n}`}
					role="option"
					aria-selected={n === active}
					class:active={n === active}
					onpointermove={() => (active = n)}
					onclick={() => choose(option)}
					onkeydown={() => undefined}
				>
					{#if option.kind === 'note'}
						<Icon name="file" size={14} />
						<span class="t">{option.title}</span>
						{#if option.detail}<span class="d">{option.detail}</span>{/if}
					{:else}
						<Icon name="plus" size={14} />
						<span class="t">Create note “{clean}”</span>
					{/if}
				</li>
			{:else}
				<li class="none" role="presentation">Type a note's title.</li>
			{/each}
		</ul>
		<div class="actions">
			<span class="hint">↑↓ to choose · Enter to link</span>
			<button type="button" class="btn small" onclick={() => dialog?.close()}>Cancel</button>
		</div>
	</div>
</dialog>

<style>
	.link-picker {
		width: min(32rem, calc(100vw - 2rem));
		margin-top: 12vh;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	.link-picker::backdrop {
		background: rgb(20 18 12 / 0.35);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.1rem 1.2rem 1rem;
	}
	h2 {
		margin: 0;
		overflow: hidden;
		font-size: 1rem;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	ul {
		max-height: min(22rem, 50vh);
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 0 0.5rem;
		padding: 0.45rem 0.6rem;
		border-radius: 8px;
		color: var(--text-muted);
		cursor: pointer;
	}
	li.active {
		background: var(--accent-soft);
		color: var(--text);
	}
	.t {
		overflow: hidden;
		color: var(--text);
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.d {
		grid-column: 2;
		overflow: hidden;
		font-size: 0.78rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.none {
		cursor: default;
	}
	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.hint {
		color: var(--text-faint);
		font-size: 0.78rem;
	}
	@media (pointer: coarse) {
		.hint {
			visibility: hidden;
		}
		li {
			min-height: 2.75rem;
		}
	}
</style>
