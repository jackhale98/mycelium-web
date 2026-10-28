<script lang="ts">
	// A note's org-roam details: rename it (updating links that used the old
	// title), its aliases and refs, and, for a heading note, extracting it
	// into a note of its own.
	import { fitKeyboard } from '../actions/fit-keyboard';
	import { href, router } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	let dialog: HTMLDialogElement | undefined = $state();
	let returnFocus: HTMLElement | null = null;
	let title = $state('');
	let updateLinks = $state(true);
	let newAlias = $state('');
	let newRef = $state('');
	let leaveLink = $state(true);
	let notice = $state<string | null>(null);

	const target = $derived(app.noteSheet);
	const node = $derived.by(() => {
		void app.rev;
		return target ? (app.vault.node(target.id) ?? null) : null;
	});
	const aliases = $derived.by(() => {
		void app.rev;
		return target ? app.roamValues(target.id, 'ROAM_ALIASES') : [];
	});
	const refs = $derived.by(() => {
		void app.rev;
		return target ? app.roamValues(target.id, 'ROAM_REFS') : [];
	});
	const named = $derived.by(() => {
		void app.rev;
		return node ? app.linksNamed(node.id, node.title) : [];
	});
	const linkCount = $derived(named.reduce((n, f) => n + f.count, 0));

	$effect(() => {
		if (!dialog) return;
		if (target && !dialog.open) {
			returnFocus = document.activeElement as HTMLElement | null;
			title = node?.title ?? '';
			notice = null;
			dialog.showModal();
		} else if (!target && dialog.open) dialog.close();
	});
	// The note went away (extracted elsewhere, deleted): close.
	$effect(() => {
		if (target && !node) app.noteSheet = null;
	});

	function close() {
		app.noteSheet = null;
	}

	function rename(e: SubmitEvent) {
		e.preventDefault();
		if (!node || !title.trim() || title.trim() === node.title) return;
		const count = updateLinks ? linkCount : 0;
		app.renameNode(node.id, title, updateLinks);
		notice = count ? `Renamed, and updated ${count} link${count === 1 ? '' : 's'}.` : 'Renamed.';
	}

	function add(key: 'ROAM_ALIASES' | 'ROAM_REFS', e: SubmitEvent) {
		e.preventDefault();
		if (!node) return;
		const value = (key === 'ROAM_ALIASES' ? newAlias : newRef).trim();
		if (!value) return;
		const list = key === 'ROAM_ALIASES' ? aliases : refs;
		app.setRoamValues(node.id, key, [...list, value]);
		if (key === 'ROAM_ALIASES') newAlias = '';
		else newRef = '';
	}

	function remove(key: 'ROAM_ALIASES' | 'ROAM_REFS', value: string) {
		if (!node) return;
		const list = key === 'ROAM_ALIASES' ? aliases : refs;
		app.setRoamValues(
			node.id,
			key,
			list.filter((v) => v !== value),
		);
	}

	function extract() {
		if (!node || node.level === 0) return;
		const id = app.extractNode(node.file, node.pos, leaveLink);
		if (!id) {
			notice = 'Couldn’t extract it (a note with that file name may already exist).';
			return;
		}
		close();
		router.go(href.node(id));
	}

	const isUrl = (ref: string) => /^https?:\/\//.test(ref);
</script>

<dialog
	bind:this={dialog}
	class="sheet"
	aria-labelledby="ns-title"
	use:fitKeyboard
	onclose={() => {
		close();
		returnFocus?.focus();
	}}
	onclick={(e) => e.target === dialog && close()}
>
	{#if node}
		<div class="body">
			<header>
				<h2 id="ns-title">Note details</h2>
				<button type="button" class="x" aria-label="Close" onclick={close}
					><Icon name="close" size={16} /></button
				>
			</header>

			<form class="group" onsubmit={rename}>
				<label class="label" for="ns-name">Title</label>
				<div class="row">
					<input id="ns-name" class="input" bind:value={title} autocomplete="off" />
					<button class="btn small" disabled={!title.trim() || title.trim() === node.title}
						>Rename</button
					>
				</div>
				{#if linkCount}
					<label class="check">
						<input type="checkbox" bind:checked={updateLinks} />
						Also update {linkCount} link{linkCount === 1 ? '' : 's'} that say “{node.title}” ({named.length}
						note{named.length === 1 ? '' : 's'})
					</label>
				{/if}
			</form>

			<section class="group" aria-labelledby="ns-aliases">
				<h3 class="label" id="ns-aliases">Aliases</h3>
				<p class="hint">Other names for this note: links and search find it by these too.</p>
				{#if aliases.length}
					<ul class="chips">
						{#each aliases as a (a)}
							<li>
								{a}<button
									type="button"
									aria-label={`Remove alias ${a}`}
									onclick={() => remove('ROAM_ALIASES', a)}><Icon name="close" size={12} /></button
								>
							</li>
						{/each}
					</ul>
				{/if}
				<form class="row" onsubmit={(e) => add('ROAM_ALIASES', e)}>
					<input
						class="input"
						aria-label="New alias"
						placeholder="Add an alias"
						bind:value={newAlias}
						autocomplete="off"
					/>
					<button class="btn small" disabled={!newAlias.trim()}>Add</button>
				</form>
			</section>

			<section class="group" aria-labelledby="ns-refs">
				<h3 class="label" id="ns-refs">Refs</h3>
				<p class="hint">
					What this note is about: a web page, or a citation key such as @smith2020.
				</p>
				{#if refs.length}
					<ul class="chips">
						{#each refs as r (r)}
							<li>
								{#if isUrl(r)}<a href={r} target="_blank" rel="noopener noreferrer">{r}</a
									>{:else}{r}{/if}<button
									type="button"
									aria-label={`Remove ref ${r}`}
									onclick={() => remove('ROAM_REFS', r)}><Icon name="close" size={12} /></button
								>
							</li>
						{/each}
					</ul>
				{/if}
				<form class="row" onsubmit={(e) => add('ROAM_REFS', e)}>
					<input
						class="input"
						aria-label="New ref"
						placeholder="https://… or @citekey"
						bind:value={newRef}
						autocomplete="off"
					/>
					<button class="btn small" disabled={!newRef.trim()}>Add</button>
				</form>
			</section>

			{#if node.level > 0}
				<section class="group" aria-labelledby="ns-extract">
					<h3 class="label" id="ns-extract">Its own note</h3>
					<p class="hint">
						Move this heading and everything under it into a new note, as org-roam’s extract-subtree
						does. It keeps its ID, so links to it still work.
					</p>
					<label class="check">
						<input type="checkbox" bind:checked={leaveLink} />
						Leave a link where it was
					</label>
					<button type="button" class="btn small" onclick={extract}
						>Extract into its own note</button
					>
				</section>
			{/if}

			{#if notice}<p class="notice" role="status">{notice}</p>{/if}
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		width: min(32rem, calc(100vw - 2rem));
		max-height: min(90dvh, 48rem);
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
		gap: 1rem;
		padding: 1rem 1.25rem 1.25rem;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-size: 1.02rem;
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
	.group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-top: 0.8rem;
		border-top: 1px solid var(--border);
	}
	.group:first-of-type {
		padding-top: 0;
		border-top: 0;
	}
	.label {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 650;
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.8rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	.row .input {
		flex: 1;
		min-width: 0;
	}
	.check {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.86rem;
	}
	.check input {
		accent-color: var(--accent);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chips li {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		max-width: 100%;
		padding: 0.15rem 0.2rem 0.15rem 0.6rem;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 0.84rem;
		overflow-wrap: anywhere;
	}
	.chips a {
		color: var(--link);
	}
	.chips button {
		display: grid;
		place-items: center;
		flex: none;
		width: 1.6rem;
		height: 1.6rem;
		border: 0;
		border-radius: 999px;
		background: none;
		color: var(--text-muted);
	}
	.chips button:hover {
		background: var(--surface);
		color: var(--text);
	}
	.group > .btn {
		align-self: flex-start;
	}
	.notice {
		margin: 0;
		font-size: 0.86rem;
	}
	@media (max-width: 720px) {
		.sheet {
			width: 100%;
			max-width: 100%;
			margin: auto 0 0;
			border-radius: 20px 20px 0 0;
		}
		.body {
			padding: 0.9rem 1rem calc(1rem + env(safe-area-inset-bottom));
		}
	}
	@media (pointer: coarse) {
		.chips button {
			width: 2.25rem;
			height: 2.25rem;
		}
	}
</style>
