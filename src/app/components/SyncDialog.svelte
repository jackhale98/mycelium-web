<script lang="ts">
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	let dialog: HTMLDialogElement | undefined = $state();
	let choices = $state<Record<string, 'ours' | 'theirs'>>({});

	const conflicts = $derived(app.sync.kind === 'conflict' ? app.sync.conflicts : []);
	const open = $derived(app.sync.kind === 'conflict');

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			choices = Object.fromEntries(conflicts.map((c) => [c.path, 'ours']));
			dialog.showModal();
		} else if (!open && dialog.open) dialog.close();
	});

	function resolve() {
		const resolutions = new Map(
			conflicts.map((c) => [c.path, choices[c.path] === 'theirs' ? c.theirs : c.ours]),
		);
		void app.pull(resolutions);
	}

	const trim = (s: string) => (s.endsWith('\n') ? s.slice(0, -1) : s) || '(empty)';
</script>

<dialog
	bind:this={dialog}
	class="conflicts"
	aria-labelledby="conflict-title"
	onclose={() => app.dismissSync()}
>
	<header>
		<h2 id="conflict-title">Both sides changed the same lines</h2>
		<p>
			{conflicts.length === 1 ? 'One file was' : `${conflicts.length} files were`} edited here and elsewhere
			in a way that can't be combined automatically. Choose which version to keep for each — everything
			else has merged cleanly. The merge is committed locally; push when you're ready.
		</p>
	</header>
	<div class="files">
		{#each conflicts as file (file.path)}
			<section class="file">
				<h3><Icon name="file" size={15} />{file.path}</h3>
				{#each file.hunks.filter((h) => h.conflict) as hunk, i (i)}
					<div class="hunk">
						<div class="side" class:chosen={choices[file.path] !== 'theirs'}>
							<span class="who">Yours (HEAD)</span>
							<pre>{trim(hunk.conflict!.ours)}</pre>
						</div>
						<div class="side" class:chosen={choices[file.path] === 'theirs'}>
							<span class="who">Theirs (origin)</span>
							<pre>{trim(hunk.conflict!.theirs)}</pre>
						</div>
					</div>
				{/each}
				<div class="segmented" role="radiogroup" aria-label={`Version of ${file.path} to keep`}>
					<button
						type="button"
						role="radio"
						aria-checked={choices[file.path] !== 'theirs'}
						onclick={() => (choices[file.path] = 'ours')}>Keep yours</button
					>
					<button
						type="button"
						role="radio"
						aria-checked={choices[file.path] === 'theirs'}
						onclick={() => (choices[file.path] = 'theirs')}>Use theirs</button
					>
				</div>
			</section>
		{/each}
	</div>
	<footer>
		<button type="button" class="btn" onclick={() => app.dismissSync()}>Decide later</button>
		<button type="button" class="btn primary" onclick={resolve}>Merge</button>
	</footer>
</dialog>

<style>
	.conflicts {
		width: min(52rem, calc(100vw - 2rem));
		max-height: calc(100dvh - 3rem);
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	.conflicts[open] {
		display: flex;
		flex-direction: column;
	}
	.conflicts::backdrop {
		background: rgb(20 18 12 / 0.4);
		backdrop-filter: blur(3px);
	}
	header {
		padding: 1.4rem 1.5rem 1rem;
		border-bottom: 1px solid var(--border);
	}
	h2 {
		margin: 0 0 0.4rem;
		font-family: var(--font-read);
		font-size: 1.45rem;
		font-weight: 600;
	}
	header p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.9rem;
	}
	.files {
		flex: 1;
		overflow-y: auto;
		padding: 1rem 1.5rem;
	}
	.file + .file {
		margin-top: 1.5rem;
	}
	h3 {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.82rem;
		font-weight: 600;
	}
	.hunk {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
		margin-bottom: 0.75rem;
	}
	.side {
		border: 1.5px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		opacity: 0.6;
		transition:
			opacity 0.15s var(--ease),
			border-color 0.15s var(--ease);
	}
	.side.chosen {
		border-color: var(--accent);
		opacity: 1;
	}
	.who {
		display: block;
		padding: 0.35rem 0.7rem;
		background: var(--surface-2);
		color: var(--text-muted);
		font-size: 0.72rem;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	pre {
		margin: 0;
		padding: 0.6rem 0.7rem;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		line-height: 1.55;
		white-space: pre-wrap;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border);
		background: var(--surface-2);
	}
	@media (max-width: 640px) {
		.hunk {
			grid-template-columns: 1fr;
		}
	}
</style>
