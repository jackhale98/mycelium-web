<script lang="ts">
	// Pick where to refile a heading (org-refile): any heading in the vault
	// (it becomes the last child) or a file (a top-level tree at its end).
	import { sheetGestures } from '../actions/sheet-gestures';
	import { fitKeyboard } from '../actions/fit-keyboard';
	import { tick } from 'svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	let dialog: HTMLDialogElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let query = $state('');
	let error = $state<string | null>(null);

	type Target = { path: string; pos: number | null; title: string; where: string; key: string };

	const sheet = $derived(app.refileSheet);
	const source = $derived.by(() => {
		if (!sheet) return null;
		void app.rev;
		const file = app.vault.file(sheet.path);
		const h = file?.index.headlines.find((x) => x.pos === sheet.pos);
		if (!file || !h) return null;
		// The tree's own extent, so it can't be refiled into itself.
		const next = file.index.headlines.find((x) => x.pos > h.pos && x.level <= h.level);
		return { title: h.title, path: sheet.path, from: h.pos, to: next?.pos ?? Infinity };
	});

	const targets = $derived.by((): Target[] => {
		if (!source) return [];
		void app.rev;
		const q = query.trim().toLowerCase();
		const out: Target[] = [];
		for (const file of app.vault.files.values()) {
			const title = file.index.title || file.path;
			const fileHit = !q || title.toLowerCase().includes(q) || file.path.toLowerCase().includes(q);
			if (fileHit)
				out.push({
					path: file.path,
					pos: null,
					title,
					where: `${file.path} · top level`,
					key: `${file.path}:top`,
				});
			for (const h of file.index.headlines) {
				if (file.path === source.path && h.pos >= source.from && h.pos < source.to) continue;
				const label = [...h.olp, h.title].join(' › ');
				if (q && !label.toLowerCase().includes(q) && !title.toLowerCase().includes(q)) continue;
				out.push({
					path: file.path,
					pos: h.pos,
					title: label,
					where: title,
					key: `${file.path}:${h.pos}`,
				});
			}
			if (out.length > 300) break;
		}
		return out.slice(0, 60);
	});

	$effect(() => {
		if (!dialog) return;
		if (sheet && !dialog.open) {
			query = '';
			error = null;
			dialog.showModal();
			void tick().then(() => input?.focus());
		} else if (!sheet && dialog.open) dialog.close();
	});

	function pick(t: Target) {
		if (!sheet) return;
		if (app.refile(sheet.path, sheet.pos, { path: t.path, pos: t.pos })) app.refileSheet = null;
		else error = "Can't refile there.";
	}
</script>

<dialog
	use:sheetGestures
	bind:this={dialog}
	class="sheet"
	use:fitKeyboard
	aria-labelledby="refile-title"
	onclose={() => (app.refileSheet = null)}
	onclick={(e) => e.target === dialog && (app.refileSheet = null)}
>
	{#if sheet && source}
		<div class="body">
			<header>
				<h2 id="refile-title"><Icon name="arrowRight" size={16} />Refile “{source.title}”</h2>
				<button type="button" class="x" aria-label="Close" onclick={() => (app.refileSheet = null)}
					><Icon name="close" size={16} /></button
				>
			</header>
			<input
				bind:this={input}
				bind:value={query}
				class="input"
				type="search"
				placeholder="Find a heading or file"
				aria-label="Find a heading or file"
				onkeydown={(e) => {
					if (e.key === 'Enter' && targets[0]) {
						e.preventDefault();
						pick(targets[0]);
					}
				}}
			/>
			<ul class="list" aria-label="Refile targets">
				{#each targets as t (t.key)}
					<li>
						<button type="button" onclick={() => pick(t)}>
							<Icon name={t.pos === null ? 'file' : 'chevronRight'} size={14} />
							<span class="t">{t.title}</span>
							<span class="w">{t.where}</span>
						</button>
					</li>
				{:else}
					<li class="empty">No headings match.</li>
				{/each}
			</ul>
			{#if error}<p class="notice warn" role="alert">{error}</p>{/if}
		</div>
	{/if}
</dialog>

<style>
	/* A fixed height, the list scrolling inside: the search box stays put as
	   the results narrow (rather than the sheet shrinking around them). */
	.sheet {
		width: min(36rem, calc(100vw - 2rem));
		height: min(80dvh, 40rem);
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
	.sheet[open] {
		display: flex;
		flex-direction: column;
	}
	.body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.6rem;
		min-height: 0;
		padding: 1rem 1.25rem 1.25rem;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0;
		font-size: 1.02rem;
		overflow-wrap: anywhere;
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
	.list {
		flex: 1;
		min-height: 0;
		align-content: start;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		list-style: none;
	}
	.list li + li {
		border-top: 1px solid var(--border);
	}
	.list button {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 0.5rem;
		align-items: center;
		width: 100%;
		min-height: 2.75rem;
		padding: 0.45rem 0.75rem;
		border: 0;
		background: none;
		color: var(--text);
		text-align: left;
	}
	.list button:hover {
		background: var(--surface-2);
	}
	.t {
		font-size: 0.9rem;
		font-weight: 550;
		overflow-wrap: anywhere;
	}
	.w {
		grid-column: 2;
		color: var(--text-muted);
		font-size: 0.75rem;
	}
	.empty {
		padding: 0.7rem 0.8rem;
		color: var(--text-muted);
		font-size: 0.86rem;
	}
	@media (max-width: 720px) {
		.sheet {
			width: 100%;
			max-width: 100%;
			/* --kb and --vvh come from fitKeyboard: stay above the on-screen keyboard. */
			height: min(88dvh, calc(var(--vvh, 100dvh) - 0.75rem));
			max-height: none;
			margin: auto 0 var(--kb, 0px);
			border-radius: 20px 20px 0 0;
		}
		.body {
			padding-bottom: calc(1rem + env(safe-area-inset-bottom));
		}
	}
</style>
