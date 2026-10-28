<script lang="ts">
	// Write a LaTeX formula with a live preview: KaTeX typesets it as you
	// type, mistakes are explained in plain words (and marked where they
	// are), and a palette inserts fractions, sums, matrices, Greek and
	// symbols with their first blank selected, ready to type over.
	import { sheetGestures } from '../actions/sheet-gestures';
	import { tick } from 'svelte';
	import { app } from '../state.svelte';
	import { checkTex, expandSnippet, TEX_GROUPS } from '../editor/tex';
	import Icon from './Icon.svelte';

	let dialog: HTMLDialogElement | undefined = $state();
	let area: HTMLTextAreaElement | undefined = $state();
	let tex = $state('');
	let display = $state(false);
	let group = $state(0);
	let loadFailed = $state(false);
	let katex = $state.raw<typeof import('katex').default | null>(null);

	const sheet = $derived(app.mathSheet);
	const result = $derived(katex && tex.trim() ? checkTex(katex, tex, display) : null);
	const problem = $derived(result && 'problem' in result ? result.problem : null);

	$effect(() => {
		if (!dialog) return;
		if (sheet && !dialog.open) {
			tex = sheet.tex;
			display = sheet.display;
			dialog.showModal();
			loadFailed = false;
			import('katex').then(
				(m) => (katex = m.default),
				() => (loadFailed = true),
			);
			void tick().then(() => area?.focus());
		} else if (!sheet && dialog.open) dialog.close();
	});

	function insert(snippet: string) {
		const el = area;
		if (!el) return;
		const { text, select } = expandSnippet(snippet);
		const from = el.selectionStart;
		const to = el.selectionEnd;
		tex = tex.slice(0, from) + text + tex.slice(to);
		void tick().then(() => {
			el.focus();
			if (select) el.setSelectionRange(from + select[0], from + select[1]);
			else el.setSelectionRange(from + text.length, from + text.length);
		});
	}

	function done(force = false) {
		if (!sheet || !tex.trim() || (problem && !force)) return;
		sheet.apply(tex.trim(), display);
		app.mathSheet = null;
	}

	/** Show the user where KaTeX stopped: select the offending spot. */
	function showProblem() {
		if (problem?.at == null || !area) return;
		area.focus();
		area.setSelectionRange(problem.at, Math.min(tex.length, problem.at + 1));
	}
</script>

<dialog
	use:sheetGestures
	bind:this={dialog}
	class="sheet"
	aria-labelledby="math-title"
	onclose={() => (app.mathSheet = null)}
	onclick={(e) => e.target === dialog && (app.mathSheet = null)}
>
	{#if sheet}
		<div class="body">
			<header>
				<h2 id="math-title">{sheet.editing ? 'Edit formula' : 'Insert formula'}</h2>
				<div class="views" role="radiogroup" aria-label="Placement">
					<button
						type="button"
						role="radio"
						aria-checked={!display}
						onclick={() => (display = false)}>In the line</button
					>
					<button type="button" role="radio" aria-checked={display} onclick={() => (display = true)}
						>On its own line</button
					>
				</div>
				<button type="button" class="x" aria-label="Close" onclick={() => (app.mathSheet = null)}
					><Icon name="close" size={16} /></button
				>
			</header>

			<label class="sr-only" for="math-src">LaTeX</label>
			<textarea
				id="math-src"
				bind:this={area}
				bind:value={tex}
				class="src"
				rows="3"
				spellcheck="false"
				autocapitalize="off"
				autocomplete="off"
				placeholder={'e.g. \\frac{a}{b} or E = mc^2'}
				aria-describedby="math-status"
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						done();
					}
				}}></textarea>

			<div class="preview" class:bad={!!problem} aria-live="polite" id="math-status">
				{#if !tex.trim()}
					<span class="hint">Type LaTeX above, or pick from the palette below.</span>
				{:else if !katex}
					<span class="hint"
						>{loadFailed
							? "The preview couldn't load (are you offline?). You can still insert the formula."
							: 'Loading preview…'}</span
					>
				{:else if result && 'html' in result}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- KaTeX output, trust: false -->
					<div class="typeset" class:display>{@html result.html}</div>
				{:else if problem}
					<p class="problem">
						<Icon name="alert" size={15} />
						<span>{problem.message}</span>
						{#if problem.at != null}
							<button type="button" class="link" onclick={showProblem}>Show where</button>
						{/if}
					</p>
				{/if}
			</div>

			<div class="tabs" role="tablist" aria-label="Palette">
				{#each TEX_GROUPS as g, i (g.name)}
					<button type="button" role="tab" aria-selected={group === i} onclick={() => (group = i)}
						>{g.name}</button
					>
				{/each}
			</div>
			<div class="palette" role="tabpanel" aria-label={TEX_GROUPS[group]!.name}>
				{#each TEX_GROUPS[group]!.items as s (s.tex)}
					<button
						type="button"
						title={s.label}
						aria-label={s.label}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => insert(s.tex)}>{s.show}</button
					>
				{/each}
			</div>

			<footer>
				{#if problem}
					<button type="button" class="btn small" onclick={() => done(true)}>Insert anyway</button>
				{/if}
				<button type="button" class="btn" onclick={() => (app.mathSheet = null)}>Cancel</button>
				<button
					type="button"
					class="btn primary"
					disabled={!tex.trim() || !!problem}
					onclick={() => done()}>{sheet.editing ? 'Update' : 'Insert'}</button
				>
			</footer>
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		width: min(40rem, calc(100vw - 2rem));
		max-height: min(90dvh, 44rem);
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
		gap: 0.7rem;
		padding: 1rem 1.25rem 1.25rem;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	h2 {
		flex: 1;
		margin: 0;
		font-size: 1.02rem;
	}
	.views {
		display: flex;
		padding: 2px;
		border: 1px solid var(--border);
		border-radius: 9px;
	}
	.views button,
	.tabs button {
		padding: 0.3rem 0.65rem;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--text-muted);
		font-size: 0.82rem;
		font-weight: 600;
	}
	.views button[aria-checked='true'],
	.tabs button[aria-selected='true'] {
		background: var(--accent-soft);
		color: var(--text);
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
	.src {
		width: 100%;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: max(16px, 0.95rem);
		font-variant-ligatures: none;
		resize: vertical;
	}
	.preview {
		display: grid;
		place-items: center;
		min-height: 4.5rem;
		padding: 0.6rem;
		overflow-x: auto;
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		font-size: 1.15rem;
	}
	.preview.bad {
		border-color: var(--todo);
	}
	.hint {
		color: var(--text-muted);
		font-size: 0.85rem;
	}
	.problem {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		color: var(--todo);
		font-size: 0.88rem;
	}
	.link {
		border: 0;
		background: none;
		color: var(--link);
		font: inherit;
		text-decoration: underline;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
	}
	.palette {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(2.9rem, 1fr));
		gap: 0.3rem;
		max-height: 11rem;
		overflow-y: auto;
	}
	.palette button {
		min-height: 2.6rem;
		padding: 0 0.25rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font-family: var(--font-read);
		font-size: 1.05rem;
		white-space: nowrap;
	}
	.palette button:hover {
		background: var(--surface-2);
	}
	footer {
		display: flex;
		align-items: center;
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
	}
</style>
