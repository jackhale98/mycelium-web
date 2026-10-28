<script lang="ts">
	import { sheetGestures } from '../actions/sheet-gestures';
	import { fitKeyboard } from '../actions/fit-keyboard';
	import Icon from '../components/Icon.svelte';
	import { href, router } from '../router.svelte';
	import { app } from '../state.svelte';
	import HeadingActions from './HeadingActions.svelte';
	import PropertiesEditor from '../components/PropertiesEditor.svelte';

	let dialog: HTMLDialogElement | undefined = $state();
	let returnFocus: HTMLElement | null = null;
	let title = $state('');

	const target = $derived(app.headingSheet);
	const h = $derived(target ? app.heading(target.path, target.pos) : null);
	const fileTitle = $derived(
		target ? (app.vault.file(target.path)?.index.title ?? target.path) : '',
	);

	$effect(() => {
		if (!dialog) return;
		if (target && !dialog.open) {
			returnFocus = document.activeElement as HTMLElement | null;
			title = h?.title ?? '';
			dialog.showModal();
		} else if (!target && dialog.open) dialog.close();
	});

	// The heading went away (deleted, or the file changed under it): close.
	$effect(() => {
		if (target && !h) app.headingSheet = null;
	});

	function close() {
		app.headingSheet = null;
	}

	function saveTitle() {
		if (!target || !h || title.trim() === h.title.trim()) return;
		app.setTitle(target.path, target.pos, title);
	}

	function openEditor() {
		if (!target) return;
		saveTitle();
		const owner = app.editHeading(target.path, target.pos);
		close();
		if (owner) router.go(href.node(owner));
	}

	function openNote() {
		const id = h?.id ?? h?.ownerId;
		close();
		if (id) router.go(href.node(id));
	}

	/** Tap on the backdrop (outside the sheet) closes it. */
	function onclick(e: MouseEvent) {
		if (e.target === dialog) close();
	}
</script>

<dialog
	use:sheetGestures
	use:fitKeyboard
	bind:this={dialog}
	class="sheet"
	aria-labelledby="hs-title"
	onclose={() => {
		app.headingSheet = null;
		returnFocus?.focus?.();
	}}
	{onclick}
>
	{#if target && h}
		<div class="body">
			<div class="grip" aria-hidden="true"></div>
			<header>
				<p class="where" id="hs-title">
					<Icon name="file" size={13} />{fileTitle}{h.level > 1 ? ` · level ${h.level}` : ''}
				</p>
				<button type="button" class="x" aria-label="Close" onclick={close}
					><Icon name="close" size={16} /></button
				>
			</header>
			<form
				class="title"
				onsubmit={(e) => {
					e.preventDefault();
					saveTitle();
				}}
			>
				<label class="sr-only" for="hs-heading">Heading</label>
				<input
					id="hs-heading"
					class="title-input"
					bind:value={title}
					onblur={saveTitle}
					autocomplete="off"
				/>
			</form>
			<HeadingActions
				path={target.path}
				offset={target.pos}
				todo={h.todo}
				priority={h.priority}
				tags={h.tags}
				scheduled={h.scheduled}
				deadline={h.deadline}
				id={h.id}
				keywords={h.keywords}
				nodeAction={false}
				variant="sheet"
				onclose={close}
			/>
			<details class="props-group">
				<summary>Properties</summary>
				<PropertiesEditor path={target.path} owner={target.pos} />
			</details>
			<footer>
				{#if h.ownerId}
					<button type="button" class="btn" onclick={openEditor}
						><Icon name="edit" size={15} />Edit in source</button
					>
					<button type="button" class="btn" onclick={openNote}
						><Icon name="arrowRight" size={15} />Open note</button
					>
				{/if}
				<button type="button" class="btn primary" onclick={close}>Done</button>
			</footer>
		</div>
	{/if}
</dialog>

<style>
	.props-group {
		padding-top: 0.6rem;
		border-top: 1px solid var(--border);
	}
	.props-group summary {
		min-height: 2.25rem;
		display: flex;
		align-items: center;
		font-size: 0.85rem;
		font-weight: 650;
		cursor: pointer;
	}
	.props-group[open] summary {
		margin-bottom: 0.4rem;
	}
	.sheet {
		width: min(34rem, calc(100vw - 2rem));
		max-height: min(85dvh, 44rem);
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
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.where {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		color: var(--text-muted);
		font-size: 0.8rem;
		font-weight: 550;
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
	.x:hover {
		background: var(--surface-2);
	}
	.title-input {
		width: 100%;
		padding: 0.3rem 0.1rem;
		border: 0;
		border-bottom: 1.5px solid var(--border);
		background: none;
		color: var(--text);
		font-family: var(--font-read);
		font-size: 1.4rem;
		font-weight: 600;
	}
	.title-input:focus {
		border-color: var(--accent);
		outline: none;
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	/* Phones: a bottom sheet. */
	@media (max-width: 720px) {
		.sheet {
			width: 100%;
			max-width: 100%;
			/* --kb and --vvh come from fitKeyboard: stay above the on-screen keyboard. */
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
		footer {
			justify-content: stretch;
		}
		footer .btn {
			flex: 1;
		}
	}
	@keyframes up {
		from {
			transform: translateY(40%);
			opacity: 0.4;
		}
	}
</style>
