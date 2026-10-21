<script lang="ts">
	// Add a picture: preview it, choose between a smaller copy (resized to
	// 2000px, re-encoded, location data dropped; the default) and the
	// original, add an optional caption, and save it into the vault's images
	// folder. The note gets a link to it, which shows the picture inline.
	import { app } from '../state.svelte';
	import { canShrink, formatBytes, original, shrink, type Prepared } from '../images';
	import Icon from './Icon.svelte';

	let dialog: HTMLDialogElement | undefined = $state();
	let preview = $state<string | null>(null);
	let full = $state<Prepared | null>(null);
	let small = $state<Prepared | null>(null);
	let working = $state(false);
	let choice = $state<'small' | 'original'>('small');
	let caption = $state('');
	let error = $state<string | null>(null);
	let saving = $state(false);

	const sheet = $derived(app.imageSheet);

	$effect(() => {
		if (!dialog) return;
		if (sheet && !dialog.open) {
			void prepare(sheet.file);
			dialog.showModal();
		} else if (!sheet && dialog.open) dialog.close();
	});

	async function prepare(file: File) {
		error = null;
		caption = '';
		saving = false;
		full = small = null;
		if (preview) URL.revokeObjectURL(preview);
		preview = URL.createObjectURL(file);
		working = true;
		try {
			full = await original(file);
			small = canShrink(file) ? await shrink(file) : null;
			// Only worth offering when it really is smaller.
			if (small && small.bytes.length >= full.bytes.length * 0.9) small = null;
			choice = small ? 'small' : 'original';
		} catch {
			error = "This picture couldn't be read.";
		} finally {
			working = false;
		}
	}

	function close() {
		app.imageSheet = null;
		if (preview) URL.revokeObjectURL(preview);
		preview = null;
	}

	async function save() {
		const s = sheet;
		const pick = choice === 'small' && small ? small : full;
		if (!s || !pick) return;
		saving = true;
		error = null;
		try {
			const link = await app.saveImage(s.note, s.file.name, pick.bytes, pick.ext);
			s.insert(link, caption.trim());
			close();
		} catch (e) {
			error = `Couldn't save the picture: ${e instanceof Error ? e.message : String(e)}`;
			saving = false;
		}
	}

	const dims = (p: Prepared) => (p.width ? `${p.width}×${p.height}, ` : '');
</script>

<dialog
	bind:this={dialog}
	class="sheet"
	aria-labelledby="image-title"
	onclose={close}
	onclick={(e) => e.target === dialog && close()}
>
	{#if sheet}
		<div class="body">
			<header>
				<h2 id="image-title">Add picture</h2>
				<button type="button" class="x" aria-label="Close" onclick={close}
					><Icon name="close" size={16} /></button
				>
			</header>

			{#if preview}
				<img class="preview" src={preview} alt="Preview of the file you chose" />
			{/if}

			{#if working}
				<p class="hint">Preparing…</p>
			{:else if full}
				<fieldset class="choices">
					<legend>Save as</legend>
					{#if small}
						<label class="choice" class:on={choice === 'small'}>
							<input type="radio" name="size" value="small" bind:group={choice} />
							<span>
								<strong>Smaller · {formatBytes(small.bytes.length)}</strong>
								<span class="detail"
									>{dims(small)}{small.type === 'image/png' ? 'PNG' : 'JPEG'}. Light for git and
									sync; location data removed.</span
								>
							</span>
						</label>
					{/if}
					<label class="choice" class:on={choice === 'original'}>
						<input type="radio" name="size" value="original" bind:group={choice} />
						<span>
							<strong>Original · {formatBytes(full.bytes.length)}</strong>
							<span class="detail"
								>{dims(full)}exactly as it is{small ? ', including its metadata' : ''}.</span
							>
						</span>
					</label>
				</fieldset>
			{/if}

			<label class="field">
				<span>Caption <span class="opt">(optional)</span></span>
				<input class="input" bind:value={caption} placeholder="Shown under the picture" />
			</label>
			<p class="where">Saved in <code>{app.imageDir || '.'}/</code></p>

			{#if error}<p class="notice warn" role="alert">{error}</p>{/if}
			<footer>
				<button type="button" class="btn" onclick={close}>Cancel</button>
				<button
					type="button"
					class="btn primary"
					disabled={working || saving || !full}
					onclick={save}>{saving ? 'Saving…' : 'Add picture'}</button
				>
			</footer>
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		width: min(32rem, calc(100vw - 2rem));
		max-height: min(90dvh, 46rem);
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
		gap: 0.75rem;
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
	.preview {
		display: block;
		width: 100%;
		max-height: 14rem;
		border-radius: var(--radius);
		background: var(--surface-2);
		object-fit: contain;
	}
	.choices {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		margin-bottom: 0.35rem;
		font-size: 0.82rem;
		font-weight: 650;
	}
	.choice {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		cursor: pointer;
	}
	.choice.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.choice input {
		margin-top: 0.2rem;
	}
	.choice > span {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.detail,
	.hint,
	.where,
	.opt {
		color: var(--text-muted);
		font-size: 0.82rem;
	}
	.where,
	.hint {
		margin: 0;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
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
			margin: auto 0 0;
			border-radius: 20px 20px 0 0;
		}
		.body {
			padding: 0.9rem 1rem calc(1rem + env(safe-area-inset-bottom));
		}
		.preview {
			max-height: 9rem;
		}
	}
</style>
