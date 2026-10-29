<script lang="ts">
	import { sheetGestures } from '../actions/sheet-gestures';
	import { fitKeyboard } from '../actions/fit-keyboard';
	import {
		applyQuickAdd,
		describeTarget,
		expandTemplate,
		shapeCapture,
		templatePrompts,
		type CaptureTemplate,
	} from '$lib/org';
	import { tick } from 'svelte';
	import { router } from '../router.svelte';
	import { app, localNow } from '../state.svelte';
	import Icon from './Icon.svelte';
	import QuickAddChips from './QuickAddChips.svelte';

	let dialog: HTMLDialogElement | undefined = $state();
	let textArea: HTMLTextAreaElement | undefined = $state();
	let returnFocus: HTMLElement | null = null;

	let templateId = $state('');
	let text = $state('');
	let title = $state('');
	let values = $state<Record<string, string>>({});
	/** Quick-add parts to keep as words (their chips' ×). */
	let keep = $state<string[]>([]);

	const templates = $derived(app.captureTemplates);
	const template = $derived<CaptureTemplate | undefined>(
		templates.find((t) => t.id === templateId) ?? templates[0],
	);
	const prompts = $derived(template ? templatePrompts(template.template) : []);
	const isNode = $derived(template?.target.kind === 'node');
	const allTags = $derived.by(() => {
		void app.rev;
		return [...app.vault.tags.keys()].sort();
	});

	/** The current note, for %a. */
	const link = $derived.by(() => {
		const route = router.route;
		if (route.name !== 'node') return undefined;
		const node = app.vault.node(route.id);
		return node ? `[[id:${node.id}][${node.title}]]` : undefined;
	});

	/** A template that reads the text as a quick add: what it understood. */
	const quick = $derived(
		template?.parse && template.type === 'entry' && text.trim() ? app.quickAdd(text, keep) : null,
	);
	const preview = $derived.by(() => {
		if (!template) return '';
		const shaped = shapeCapture(
			expandTemplate(template.template, {
				now: localNow(),
				text: quick ? quick.title : text.trim(),
				values,
				link,
			}),
			template.type,
		);
		return quick ? applyQuickAdd(shaped, quick, app.vault.keywords) : shaped;
	});
	const canSave = $derived(
		!!template && (isNode ? !!(title.trim() || text.trim()) : !!text.trim() || prompts.length > 0),
	);

	function choose(id: string) {
		templateId = id;
		values = {};
		for (const p of templatePrompts(templates.find((t) => t.id === id)?.template ?? ''))
			if (p.default) values[p.id] = p.default;
		void tick().then(focusFirst);
	}

	/** The cursor starts in the first empty field (a title, a prompt), else the text. */
	function focusFirst() {
		const empty = [...(dialog?.querySelectorAll<HTMLInputElement>('.field input') ?? [])].find(
			(i) => !i.value,
		);
		(empty ?? textArea)?.focus();
	}

	$effect(() => {
		if (!dialog) return;
		const open = app.captureSheet;
		if (open && !dialog.open) {
			returnFocus = document.activeElement as HTMLElement | null;
			text = open.text ?? '';
			title = '';
			keep = [];
			choose(open.templateId ?? templates[0]?.id ?? '');
			dialog.showModal();
		} else if (!open && dialog.open) dialog.close();
	});

	function close() {
		app.captureSheet = null;
	}

	function save(e?: Event) {
		e?.preventDefault();
		if (!template || !canSave) return;
		const result = app.captureWith(template, {
			text,
			values: $state.snapshot(values),
			title,
			keep: [...keep],
			...(link ? { link } : {}),
		});
		if (!result) return;
		app.captureNotice = { label: result.label, id: result.id, path: result.path };
		close();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return save(e);
		// org-capture's menu: a template's key picks it when not typing.
		const t = e.target as HTMLElement;
		if (t.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
		const hit = templates.find((x) => x.key === e.key);
		if (hit) {
			e.preventDefault();
			choose(hit.id);
		}
	}
</script>

<dialog
	use:sheetGestures
	use:fitKeyboard
	bind:this={dialog}
	class="sheet"
	aria-labelledby="cs-title"
	onclose={() => {
		app.captureSheet = null;
		returnFocus?.focus?.();
	}}
	onclick={(e) => e.target === dialog && close()}
	{onkeydown}
>
	{#if app.captureSheet && template}
		<form class="body" onsubmit={save}>
			<div class="grip" aria-hidden="true"></div>
			<header>
				<h2 id="cs-title"><Icon name="feather" size={16} />Capture</h2>
				<button type="button" class="x" aria-label="Close" onclick={close}
					><Icon name="close" size={16} /></button
				>
			</header>

			<div class="templates" role="radiogroup" aria-label="Template">
				{#each templates as t (t.id)}
					<button
						type="button"
						role="radio"
						aria-checked={t.id === template.id}
						onclick={() => choose(t.id)}><kbd aria-hidden="true">{t.key}</kbd>{t.name}</button
					>
				{/each}
			</div>
			<p class="where"><Icon name="file" size={13} />To {describeTarget(template.target)}</p>

			{#if isNode}
				<label class="field"
					><span>Title</span><input bind:value={title} autocomplete="off" required /></label
				>
			{/if}
			{#each prompts as p (p.id)}
				<label class="field">
					<span>{p.label}</span>
					{#if p.kind === 'date'}
						<input type="date" bind:value={values[p.id]} />
					{:else if p.kind === 'datetime'}
						<input type="datetime-local" bind:value={values[p.id]} />
					{:else if p.kind === 'tags'}
						<input
							bind:value={values[p.id]}
							list="cs-tags"
							placeholder="work, errands"
							autocapitalize="off"
							autocomplete="off"
						/>
					{:else}
						<input
							bind:value={values[p.id]}
							list={p.options.length ? `cs-opt-${p.id}` : undefined}
							autocomplete="off"
						/>
						{#if p.options.length}
							<datalist id={`cs-opt-${p.id}`}
								>{#each p.options as o (o)}<option value={o}></option>{/each}</datalist
							>
						{/if}
					{/if}
				</label>
			{/each}
			<datalist id="cs-tags"
				>{#each allTags as tag (tag)}<option value={tag}></option>{/each}</datalist
			>

			<label class="field grow">
				<span class="sr-only">Text</span>
				<textarea
					bind:this={textArea}
					bind:value={text}
					rows="3"
					placeholder={isNode
						? 'Body (optional)'
						: template.parse
							? 'Call Sam tomorrow 3pm #work !A'
							: 'What do you want to capture?'}
					enterkeyhint="enter"></textarea>
			</label>
			{#if quick}
				<QuickAddChips
					q={quick}
					today={localNow().date}
					onkeep={(words) => (keep = [...keep, words])}
				/>
			{/if}

			<details class="preview">
				<summary>Preview</summary>
				<pre>{preview}</pre>
			</details>

			<footer>
				<span class="hint" aria-hidden="true"><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>↵</kbd></span>
				<button type="button" class="btn" onclick={close}>Cancel</button>
				<button type="submit" class="btn primary" disabled={!canSave}>Capture</button>
			</footer>
		</form>
	{/if}
</dialog>

<style>
	.sheet {
		width: min(34rem, calc(100vw - 2rem));
		max-height: min(88dvh, 46rem);
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
		gap: 0.7rem;
		padding: 1rem 1.25rem 1.25rem;
	}
	.grip {
		display: none;
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
		font-size: 1.05rem;
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
	.templates {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.templates button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.25rem;
		padding: 0.25rem 0.75rem 0.25rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.85rem;
		font-weight: 600;
	}
	.templates button[aria-checked='true'] {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent-strong);
	}
	kbd {
		display: inline-grid;
		place-items: center;
		min-width: 1.35rem;
		height: 1.35rem;
		padding: 0 0.25rem;
		border-radius: 6px;
		background: var(--surface-2);
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.72rem;
	}
	.where {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: -0.2rem 0 0;
		color: var(--text-muted);
		font-size: 0.8rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-muted);
	}
	.field input,
	textarea {
		width: 100%;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-size: 0.95rem;
		font-weight: 400;
	}
	textarea {
		min-height: 6rem;
		resize: vertical;
		font-family: var(--font-read);
		font-size: 1.05rem;
		line-height: 1.5;
	}
	.field input:focus,
	textarea:focus {
		border-color: var(--accent);
		outline: none;
	}
	.preview summary {
		color: var(--text-muted);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.preview pre {
		margin: 0.4rem 0 0;
		padding: 0.6rem 0.8rem;
		overflow-x: auto;
		border-radius: 8px;
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: 0.8rem;
		white-space: pre-wrap;
	}
	footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.hint {
		margin-right: auto;
		color: var(--text-faint);
		font-size: 0.75rem;
	}
	@media (max-width: 720px) {
		.sheet {
			width: 100%;
			max-width: 100%;
			/* --kb and --vvh come from fitKeyboard: stay above the on-screen keyboard. */
			max-height: min(92dvh, calc(var(--vvh, 100dvh) - 0.75rem));
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
		.hint {
			display: none;
		}
		/* One scrolling row of templates, and a text box that fits the space left. */
		.templates {
			flex-wrap: nowrap;
			margin: 0 -1rem;
			padding: 0 1rem 0.15rem;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.templates button {
			flex: none;
		}
		textarea {
			min-height: 4.5rem;
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
