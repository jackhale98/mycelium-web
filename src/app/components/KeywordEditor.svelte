<script lang="ts">
	import {
		configToSequences,
		formatTodoLine,
		isValidKeyword,
		parseTodoLine,
		sequencesToConfig,
		type KeywordSequence,
		type KeywordState,
	} from '$lib/org';
	import type { KeywordTone } from '$lib/store/db';
	import { app } from '../state.svelte';
	import { keywordTone } from '../util';
	import Icon from './Icon.svelte';

	/** A state being edited, remembering the name it had when the editor opened. */
	type Row = KeywordState & { id: number; orig: string | null };
	type Seq = { id: number; todo: Row[]; done: Row[] };

	let nextId = 0;
	const toRows = (states: KeywordState[]): Row[] =>
		states.map((s) => ({ ...s, id: nextId++, orig: s.name }));
	const fromConfig = (): Seq[] =>
		configToSequences(app.vault.keywords).map((s) => ({
			id: nextId++,
			todo: toRows(s.todo),
			done: toRows(s.done),
		}));

	let seqs = $state<Seq[]>(fromConfig());
	let tones = $state<Record<string, KeywordTone>>({ ...app.keywordTones });
	let confirming = $state(false);
	let updateHeadings = $state(true);
	let message = $state<string | null>(null);

	const usage = $derived(app.keywordUsage());
	const all = $derived(seqs.flatMap((s) => [...s.todo, ...s.done]));
	const names = $derived(all.map((r) => r.name.trim()));
	const problems = $derived.by(() => {
		const out: string[] = [];
		const seen = new Set<string>();
		for (const n of names) {
			if (!n) out.push('Every state needs a name.');
			else if (!isValidKeyword(n)) out.push(`“${n}” can't contain spaces, parentheses or |.`);
			else if (seen.has(n)) out.push(`“${n}” is used twice.`);
			seen.add(n);
		}
		for (const s of seqs)
			if (!s.done.length) out.push('Each workflow needs at least one done state.');
		const keys = all.map((r) => r.key).filter(Boolean);
		if (new Set(keys).size !== keys.length) out.push('Two states share a shortcut key.');
		return [...new Set(out)];
	});
	const renames = $derived(
		all
			.filter((r) => r.orig && r.orig !== r.name.trim() && (usage.counts.get(r.orig) ?? 0) > 0)
			.map((r) => ({ from: r.orig!, to: r.name.trim(), count: usage.counts.get(r.orig!) ?? 0 })),
	);
	const removed = $derived(
		[...usage.counts.entries()]
			.filter(
				([name]) =>
					!all.some((r) => r.orig === name) &&
					!names.includes(name) &&
					[...app.vault.keywords.todoKeywords, ...app.vault.keywords.doneKeywords].includes(name),
			)
			.map(([name, count]) => ({ name, count })),
	);
	const sequences = $derived<KeywordSequence[]>(
		seqs.map((s) => ({
			todo: s.todo.map(({ name, key, enter, leave }) => ({ name: name.trim(), key, enter, leave })),
			done: s.done.map(({ name, key, enter, leave }) => ({ name: name.trim(), key, enter, leave })),
		})),
	);
	const preview = $derived(sequences.map((s) => `#+TODO: ${formatTodoLine(s)}`).join('\n'));
	const dirty = $derived(
		JSON.stringify(sequences) !== JSON.stringify(configToSequences(app.vault.keywords)) ||
			JSON.stringify(tones) !== JSON.stringify(app.keywordTones),
	);

	const PRESETS = [
		{ label: 'org default', line: 'TODO | DONE' },
		{ label: 'GTD', line: 'TODO(t) NEXT(n) WAITING(w@/!) | DONE(d!) CANCELLED(c@)' },
		{ label: 'Kanban', line: 'BACKLOG TODO DOING REVIEW | DONE' },
	];
	const TONES: { value: KeywordTone; label: string }[] = [
		{ value: 'todo', label: 'Amber' },
		{ value: 'next', label: 'Blue' },
		{ value: 'wait', label: 'Violet' },
		{ value: 'done', label: 'Green' },
		{ value: 'neutral', label: 'Grey' },
	];
	const LOG = [
		{ value: '', label: 'No log' },
		{ value: '!', label: 'Time' },
		{ value: '@', label: 'Note' },
	];

	function add(seq: Seq, lane: 'todo' | 'done', name = '') {
		seq[lane].push({ name, key: null, enter: null, leave: null, id: nextId++, orig: null });
	}
	function move(list: Row[], i: number, by: -1 | 1) {
		const j = i + by;
		if (j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j]!, list[i]!];
	}
	function preset(line: string) {
		const parsed = parseTodoLine(line);
		seqs = [{ id: nextId++, todo: toRows(parsed.todo), done: toRows(parsed.done) }];
		// Keep the link to existing names so in-use keywords aren't treated as renames.
		for (const r of [...seqs[0]!.todo, ...seqs[0]!.done]) r.orig = r.name;
	}
	function adopt(word: string, lane: 'todo' | 'done') {
		add(seqs[0]!, lane, word);
	}
	function reset() {
		seqs = fromConfig();
		tones = { ...app.keywordTones };
		confirming = false;
	}

	async function save() {
		if (problems.length) return;
		if ((renames.length || removed.length) && !confirming) {
			confirming = true;
			return;
		}
		let note = '';
		if (updateHeadings && renames.length) {
			let files = 0;
			let headings = 0;
			for (const r of renames) {
				const done = app.renameKeyword(r.from, r.to);
				files += done.files;
				headings += done.headings;
			}
			note = ` Updated ${headings} ${headings === 1 ? 'heading' : 'headings'} in ${files} ${files === 1 ? 'file' : 'files'} — review them in Changes.`;
		}
		const kept = Object.fromEntries(
			Object.entries(tones).filter(([name]) => names.includes(name)),
		) as Record<string, KeywordTone>;
		await app.saveKeywords(sequencesToConfig(sequences), kept);
		seqs = fromConfig();
		confirming = false;
		message = `Keywords saved.${note}`;
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(preview);
			message = 'Copied the #+TODO line.';
		} catch {
			message = 'Copy failed — select the text instead.';
		}
	}
</script>

<div class="kw-editor">
	<div class="presets" role="group" aria-label="Start from a preset">
		<span class="label">Presets</span>
		{#each PRESETS as p (p.label)}
			<button type="button" class="btn small" onclick={() => preset(p.line)}>{p.label}</button>
		{/each}
	</div>

	{#each seqs as seq, si (seq.id)}
		<fieldset class="seq">
			<legend>
				Workflow {seqs.length > 1 ? si + 1 : ''}
				{#if seqs.length > 1}
					<button type="button" class="link" onclick={() => (seqs = seqs.filter((s) => s !== seq))}
						>Remove workflow</button
					>
				{/if}
			</legend>
			{#each ['todo', 'done'] as const as lane (lane)}
				<div class="lane">
					<h3>{lane === 'todo' ? 'Open states' : 'Done states'}</h3>
					<ul>
						{#each seq[lane] as row, i (row.id)}
							{@const tone = tones[row.name] ?? keywordTone(row.name, sequencesToConfig(sequences))}
							<li class="state">
								<span class={`swatch ${tone}`} aria-hidden="true">{row.name || '…'}</span>
								<label class="name">
									<span class="sr-only">Name</span>
									<input
										class="input"
										bind:value={row.name}
										oninput={() => (row.name = row.name.toUpperCase().replace(/\s/g, ''))}
										autocapitalize="characters"
										spellcheck="false"
										placeholder="NAME"
									/>
								</label>
								<label class="key" title="Fast-access key, as in TODO(t)">
									<span class="sr-only">Shortcut key for {row.name}</span>
									<input
										class="input"
										maxlength="1"
										value={row.key ?? ''}
										oninput={(e) => (row.key = e.currentTarget.value.trim() || null)}
										placeholder="key"
									/>
								</label>
								<label>
									<span class="sr-only">Colour of {row.name}</span>
									<select
										class="input"
										value={tone}
										onchange={(e) => (tones[row.name] = e.currentTarget.value as KeywordTone)}
									>
										{#each TONES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
									</select>
								</label>
								<label title="Log when a heading enters this state">
									<span class="sr-only">Log on entering {row.name}</span>
									<select
										class="input"
										value={row.enter ?? ''}
										onchange={(e) =>
											(row.enter = (e.currentTarget.value || null) as '!' | '@' | null)}
									>
										{#each LOG as l (l.value)}<option value={l.value}>On enter: {l.label}</option
											>{/each}
									</select>
								</label>
								<label title="Log when a heading leaves this state">
									<span class="sr-only">Log on leaving {row.name}</span>
									<select
										class="input"
										value={row.leave ?? ''}
										onchange={(e) =>
											(row.leave = (e.currentTarget.value || null) as '!' | '@' | null)}
									>
										{#each LOG as l (l.value)}<option value={l.value}>On leave: {l.label}</option
											>{/each}
									</select>
								</label>
								<span class="tools">
									<button
										type="button"
										class="icon"
										aria-label={`Move ${row.name} earlier`}
										disabled={i === 0}
										onclick={() => move(seq[lane], i, -1)}
										><span class="up"><Icon name="chevronDown" size={15} /></span></button
									>
									<button
										type="button"
										class="icon"
										aria-label={`Move ${row.name} later`}
										disabled={i === seq[lane].length - 1}
										onclick={() => move(seq[lane], i, 1)}
										><Icon name="chevronDown" size={15} /></button
									>
									<button
										type="button"
										class="icon danger"
										aria-label={`Remove ${row.name}`}
										onclick={() => seq[lane].splice(i, 1)}><Icon name="trash" size={15} /></button
									>
								</span>
								{#if row.orig && usage.counts.get(row.orig)}
									<span class="uses">{usage.counts.get(row.orig)} headings</span>
								{/if}
							</li>
						{/each}
					</ul>
					<button type="button" class="btn small" onclick={() => add(seq, lane)}
						><Icon name="plus" size={14} />Add {lane === 'todo' ? 'open' : 'done'} state</button
					>
				</div>
			{/each}
		</fieldset>
	{/each}
	<button
		type="button"
		class="btn small"
		onclick={() =>
			seqs.push({
				id: nextId++,
				todo: toRows(parseTodoLine('NEW').todo),
				done: toRows(parseTodoLine('NEW | CLOSED').done),
			})}><Icon name="plus" size={14} />Add another workflow</button
	>

	{#if usage.candidates.length}
		<div class="found">
			<h3>Found in your notes</h3>
			<p class="hint">Words that start several headings but aren't keywords yet.</p>
			<ul>
				{#each usage.candidates.filter(([w]) => !names.includes(w)) as [word, count] (word)}
					<li>
						<code>{word}</code> <span class="hint">{count} headings</span>
						<button type="button" class="btn small" onclick={() => adopt(word, 'todo')}
							>Add as open</button
						>
						<button type="button" class="btn small" onclick={() => adopt(word, 'done')}
							>Add as done</button
						>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="preview">
		<div class="row between">
			<h3>As an org line</h3>
			<button type="button" class="btn small" onclick={copy}>Copy</button>
		</div>
		<pre>{preview}</pre>
		<p class="hint">
			These are this vault's global keywords (Emacs' <code>org-todo-keywords</code>). A file with
			its own <code>#+TODO:</code> line keeps using that{usage.ownFiles.length
				? ` — ${usage.ownFiles.length} ${usage.ownFiles.length === 1 ? 'file does' : 'files do'}: ${usage.ownFiles.slice(0, 4).join(', ')}${usage.ownFiles.length > 4 ? '…' : ''}`
				: ''}.
		</p>
	</div>

	{#if problems.length}
		<ul class="problems" role="alert">
			{#each problems as p (p)}<li><Icon name="alert" size={14} />{p}</li>{/each}
		</ul>
	{/if}

	{#if confirming}
		<div class="confirm" role="alertdialog" aria-labelledby="kw-confirm">
			<h3 id="kw-confirm">Before saving</h3>
			{#if renames.length}
				<label class="check"
					><input type="checkbox" bind:checked={updateHeadings} />
					Also rename on existing headings:
					{renames.map((r) => `${r.from} → ${r.to} (${r.count})`).join(', ')}</label
				>
			{/if}
			{#if removed.length}
				<p>
					<Icon name="alert" size={14} />
					{removed.map((r) => `${r.name} (${r.count})`).join(', ')}
					{removed.length === 1 ? 'is' : 'are'} still used. Without the keyword, org reads the word as
					part of the heading's title.
				</p>
			{/if}
		</div>
	{/if}

	<div class="row actions">
		<button type="button" class="btn" disabled={!dirty} onclick={reset}>Reset</button>
		<button
			type="button"
			class="btn primary"
			disabled={!dirty || problems.length > 0}
			onclick={save}>{confirming ? 'Confirm and save' : 'Save keywords'}</button
		>
		<span class="msg" role="status">{message ?? ''}</span>
	</div>
</div>

<style>
	.kw-editor {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.label,
	h3 {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.74rem;
		font-weight: 650;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.seq {
		/* Fieldsets default to min-content width, which overflows narrow phones. */
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin: 0;
		padding: 0.9rem 1rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	legend {
		display: flex;
		gap: 0.75rem;
		padding: 0 0.4rem;
		font-weight: 650;
	}
	.link {
		border: 0;
		background: none;
		color: var(--danger);
		font-size: 0.8rem;
	}
	.lane ul {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin: 0.5rem 0;
		padding: 0;
		list-style: none;
	}
	/* Each keyword a small card of its own, so its controls read as one group. */
	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
		padding: 0.65rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface-2);
	}
	.state > label {
		min-width: 0;
		max-width: 100%;
	}
	.state .input {
		width: auto;
		max-width: 100%;
		height: 2.1rem;
		font-size: 0.84rem;
	}
	.name .input {
		width: 9rem;
		font-family: var(--font-mono);
		font-weight: 600;
	}
	.key .input {
		width: 3.4rem;
		text-align: center;
	}
	.swatch {
		min-width: 4.5rem;
		padding: 0.15rem 0.45rem;
		border-radius: 5px;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-align: center;
	}
	.swatch.todo {
		background: var(--todo-soft);
		color: var(--todo);
	}
	.swatch.next {
		background: var(--next-soft);
		color: var(--next);
	}
	.swatch.wait {
		background: var(--wait-soft);
		color: var(--wait);
	}
	.swatch.done {
		background: var(--done-soft);
		color: var(--done);
	}
	.swatch.neutral {
		background: var(--surface-2);
		color: var(--text-2);
	}
	.tools {
		display: flex;
		gap: 0.1rem;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--text-muted);
	}
	.icon:hover:not(:disabled) {
		background: var(--surface-2);
	}
	.icon:disabled {
		opacity: 0.35;
	}
	.icon.danger:hover {
		background: var(--danger-soft);
		color: var(--danger);
	}
	.up {
		display: grid;
		transform: rotate(180deg);
	}
	.uses {
		color: var(--text-faint);
		font-size: 0.74rem;
	}
	.found ul {
		margin: 0.4rem 0 0;
		padding: 0;
		list-style: none;
	}
	.found li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0;
	}
	.hint {
		margin: 0.25rem 0 0;
		color: var(--text-muted);
		font-size: 0.8rem;
	}
	.preview pre {
		margin: 0.4rem 0 0;
		padding: 0.6rem 0.8rem;
		overflow-x: auto;
		border-radius: 8px;
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}
	.between {
		justify-content: space-between;
	}
	.problems {
		margin: 0;
		padding: 0;
		color: var(--danger);
		font-size: 0.84rem;
		list-style: none;
	}
	.problems li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.confirm {
		padding: 0.8rem 1rem;
		border: 1px solid var(--todo);
		border-radius: var(--radius);
		background: var(--todo-soft);
		font-size: 0.86rem;
	}
	.confirm p {
		display: flex;
		gap: 0.4rem;
		margin: 0.5rem 0 0;
	}
	.check {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
	.actions {
		align-items: center;
	}
	.msg {
		color: var(--text-muted);
		font-size: 0.84rem;
	}
	.state :global(select),
	.state :global(input) {
		max-width: 100%;
	}
</style>
