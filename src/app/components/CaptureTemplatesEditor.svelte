<script lang="ts">
	import {
		DEFAULT_CAPTURE_TEMPLATES,
		describeTarget,
		expandTemplate,
		shapeCapture,
		templatePrompts,
		type CaptureTemplate,
		type CaptureType,
	} from '$lib/org';
	import { app, localNow } from '../state.svelte';
	import Icon from './Icon.svelte';

	const clone = (list: CaptureTemplate[]): CaptureTemplate[] =>
		list.map((t) => ({ ...t, target: { ...t.target } }));

	let list = $state<CaptureTemplate[]>(clone(app.captureTemplates));
	let message = $state<string | null>(null);

	const TYPES: { value: CaptureType; label: string }[] = [
		{ value: 'entry', label: 'Heading (entry)' },
		{ value: 'item', label: 'List item' },
		{ value: 'checkitem', label: 'Checkbox' },
		{ value: 'plain', label: 'Plain text' },
	];

	/** Paths relative to the notes folder, for the file picker. */
	const files = $derived.by(() => {
		void app.rev;
		const root = app.layout.roamDir ? `${app.layout.roamDir}/` : '';
		return [...app.vault.files.keys()]
			.filter((p) => !app.isDaily(p))
			.map((p) => (root && p.startsWith(root) ? p.slice(root.length) : p))
			.sort();
	});

	const problems = $derived.by(() => {
		const out: string[] = [];
		const keys = new Set<string>();
		for (const t of list) {
			const label = t.name.trim() || 'A template';
			if (!t.name.trim()) out.push('Every template needs a name.');
			if (t.key.length !== 1) out.push(`${label}: the key is a single character.`);
			else if (keys.has(t.key)) out.push(`Two templates use the key “${t.key}”.`);
			keys.add(t.key);
			if (t.target.kind === 'file' && !/\.org$/i.test(t.target.path.trim()))
				out.push(`${label}: the file should be an .org file.`);
		}
		return [...new Set(out)];
	});
	const dirty = $derived(JSON.stringify(list) !== JSON.stringify(app.captureTemplates));

	function preview(t: CaptureTemplate): string {
		const values: Record<string, string> = {};
		for (const p of templatePrompts(t.template))
			values[p.id] =
				p.default ||
				(p.kind === 'date'
					? localNow().date
					: p.kind === 'datetime'
						? `${localNow().date}T${localNow().time}`
						: p.kind === 'tags'
							? 'tag'
							: p.label);
		return shapeCapture(
			expandTemplate(t.template, { now: localNow(), text: 'Your text', values }),
			t.type,
		);
	}

	function setTarget(t: CaptureTemplate, kind: string) {
		const heading = 'heading' in t.target ? t.target.heading : null;
		t.target =
			kind === 'node'
				? { kind: 'node' }
				: kind === 'file'
					? { kind: 'file', path: 'inbox.org', heading: heading ?? 'Inbox' }
					: { kind: 'daily', heading };
	}

	function add() {
		const used = new Set(list.map((t) => t.key));
		const key = [...'abcdefghijklmopqsuvwxyz'].find((k) => !used.has(k)) ?? '';
		list.push({
			id: crypto.randomUUID(),
			key,
			name: 'New template',
			type: 'entry',
			target: { kind: 'file', path: 'inbox.org', heading: 'Inbox' },
			template: '* TODO %?\n%U',
		});
	}
	function move(i: number, by: -1 | 1) {
		const j = i + by;
		if (j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j]!, list[i]!];
	}

	async function save() {
		if (problems.length) return;
		const trimmed = list.map((t) => ({
			...t,
			name: t.name.trim(),
			target:
				t.target.kind === 'node'
					? t.target
					: {
							...t.target,
							heading: t.target.heading?.trim() || null,
							...(t.target.kind === 'file' ? { path: t.target.path.trim() } : {}),
						},
		})) as CaptureTemplate[];
		await app.saveCaptureTemplates(trimmed);
		list = clone(app.captureTemplates);
		message = 'Capture templates saved';
		setTimeout(() => (message = null), 2500);
	}
	async function reset() {
		if (!confirm('Replace your capture templates with Mycelium’s defaults?')) return;
		await app.saveCaptureTemplates(null);
		list = clone(DEFAULT_CAPTURE_TEMPLATES);
	}
</script>

<p class="hint">
	Like <code>org-capture-templates</code>. The first template is the home page's quick capture; all
	of them open from the capture sheet (swipe up on the search button, or <kbd>Ctrl</kbd>/<kbd>⌘</kbd
	>
	+ <kbd>Alt</kbd> + <kbd>C</kbd>). Escapes: <code>%?</code> your text, <code>%U</code>
	<code>%u</code> <code>%T</code> <code>%t</code> timestamps, <code>%&lt;%H:%M&gt;</code>,
	<code>%^&#123;Prompt&#125;</code>, <code>%^&#123;Pick|a|b&#125;</code>, <code>%^t</code>
	<code>%^T</code> dates, <code>%^g</code> tags, <code>%a</code> link to the open note.
</p>

<datalist id="cte-files"
	>{#each files as f (f)}<option value={f}></option>{/each}</datalist
>

<ol class="list">
	{#each list as t, i (t.id)}
		<li class="tpl">
			<div class="row">
				<label class="key"
					><span>Key</span><input bind:value={t.key} maxlength="1" autocapitalize="off" /></label
				>
				<label class="name"><span>Name</span><input bind:value={t.name} /></label>
				<div class="order">
					<button
						type="button"
						class="icon"
						aria-label={`Move ${t.name} up`}
						disabled={i === 0}
						onclick={() => move(i, -1)}><Icon name="chevronUp" size={14} /></button
					>
					<button
						type="button"
						class="icon"
						aria-label={`Move ${t.name} down`}
						disabled={i === list.length - 1}
						onclick={() => move(i, 1)}><Icon name="chevronDown" size={14} /></button
					>
					<button
						type="button"
						class="icon"
						aria-label={`Delete ${t.name}`}
						onclick={() => list.splice(i, 1)}><Icon name="trash" size={14} /></button
					>
				</div>
			</div>
			<div class="row">
				<label
					><span>Type</span>
					<select bind:value={t.type}>
						{#each TYPES as ty (ty.value)}<option value={ty.value}>{ty.label}</option>{/each}
					</select>
				</label>
				<label
					><span>Into</span>
					<select value={t.target.kind} onchange={(e) => setTarget(t, e.currentTarget.value)}>
						<option value="daily">Today's daily note</option>
						<option value="file">A file</option>
						<option value="node">A new note</option>
					</select>
				</label>
				{#if t.target.kind === 'file'}
					<label class="grow"
						><span>File (in your notes folder)</span><input
							bind:value={t.target.path}
							list="cte-files"
							autocapitalize="off"
						/></label
					>
				{/if}
				{#if t.target.kind !== 'node'}
					<label class="grow"
						><span>Under heading</span><input
							value={t.target.heading ?? ''}
							placeholder="(top level)"
							oninput={(e) => {
								if (t.target.kind !== 'node') t.target.heading = e.currentTarget.value;
							}}
						/></label
					>
				{/if}
			</div>
			<label class="template"
				><span>Template</span><textarea
					bind:value={t.template}
					rows={Math.min(6, t.template.split('\n').length + 1)}
					spellcheck="false"
					autocapitalize="off"></textarea></label
			>
			{#if t.type === 'entry' && t.target.kind !== 'node'}
				<label class="check"
					><input
						type="checkbox"
						checked={!!t.parse}
						onchange={(e) => (t.parse = e.currentTarget.checked)}
					/> Understand dates, times, repeats, #tags, !priority and ~effort in the text</label
				>
				<label class="check"
					><input
						type="checkbox"
						checked={!!t.prepend}
						onchange={(e) => (t.prepend = e.currentTarget.checked)}
					/> Add as the first entry instead of the last</label
				>
			{/if}
			<div class="preview">
				<span>Preview · into {describeTarget(t.target)}</span>
				<pre>{preview(t)}</pre>
			</div>
		</li>
	{/each}
</ol>

{#if problems.length}
	<ul class="problems" role="alert">
		{#each problems as p (p)}<li>{p}</li>{/each}
	</ul>
{/if}

<div class="actions">
	<button type="button" class="btn small" onclick={add}
		><Icon name="plus" size={14} />Add template</button
	>
	<span class="spacer"></span>
	<button type="button" class="btn small" onclick={reset}>Reset to defaults</button>
	<button
		type="button"
		class="btn small primary"
		disabled={!dirty || problems.length > 0}
		onclick={save}>Save templates</button
	>
</div>
<p class="saved" role="status" aria-live="polite">{message ?? ''}</p>

<style>
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.82rem;
		line-height: 1.6;
	}
	code,
	kbd {
		font-family: var(--font-mono);
		font-size: 0.78rem;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.tpl {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.8rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.5rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		color: var(--text-muted);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.grow,
	.name {
		flex: 1 1 min(10rem, 100%);
		min-width: 0;
	}
	.grow input,
	.name input,
	select {
		width: 100%;
		min-width: 0;
	}
	label {
		max-width: 100%;
	}
	.key input {
		width: 2.6rem;
		text-align: center;
		font-family: var(--font-mono);
	}
	input,
	select,
	textarea {
		min-height: 2.2rem;
		padding: 0.35rem 0.55rem;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-size: 0.88rem;
		font-weight: 400;
	}
	textarea {
		font-family: var(--font-mono);
		font-size: 0.82rem;
		resize: vertical;
	}
	.order {
		display: flex;
		gap: 0.15rem;
		margin-left: auto;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text-muted);
	}
	.icon:hover:not(:disabled) {
		background: var(--surface-2);
	}
	.icon:disabled {
		opacity: 0.35;
	}
	.check {
		flex-direction: row;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.82rem;
		font-weight: 500;
	}
	.check input {
		min-height: 0;
		accent-color: var(--accent);
	}
	.preview span {
		color: var(--text-faint);
		font-size: 0.72rem;
	}
	.preview pre {
		margin: 0.25rem 0 0;
		padding: 0.5rem 0.7rem;
		overflow-x: auto;
		border-radius: 8px;
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: 0.78rem;
		white-space: pre-wrap;
	}
	.problems {
		margin: 0;
		padding-left: 1.2rem;
		color: var(--danger);
		font-size: 0.84rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.spacer {
		flex: 1;
	}
	.saved {
		min-height: 1rem;
		margin: 0;
		color: var(--accent);
		font-size: 0.84rem;
		font-weight: 600;
	}
</style>
