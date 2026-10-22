<script lang="ts">
	import { fullTextSearch, type TextSnippet } from '$lib/vault/fulltext';
	import Icon from '../components/Icon.svelte';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import { usePane } from '../panes.svelte';

	let { q = '' }: { q?: string } = $props();
	const pane = usePane();

	let query = $state(q);
	let debounced = $state(q);
	let input: HTMLInputElement | undefined = $state();

	$effect(() => {
		const value = query;
		const t = setTimeout(() => {
			debounced = value;
			const hash = href.search(value.trim());
			pane.replace(hash);
		}, 150);
		return () => clearTimeout(t);
	});

	$effect(() => {
		input?.focus();
		document.title = 'Search · Mycelium';
	});

	const nodes = $derived.by(() => {
		void app.rev;
		return debounced.trim() ? app.search.search(debounced, 8) : [];
	});
	const files = $derived.by(() => {
		void app.rev;
		return fullTextSearch(app.vault, debounced, { limit: 60 });
	});
	const total = $derived(files.reduce((n, f) => n + f.snippets.length + f.more, 0));

	function parts(s: TextSnippet) {
		const out: { text: string; mark: boolean }[] = [];
		let at = 0;
		for (const [from, to] of s.marks) {
			if (from < at) continue;
			if (from > at) out.push({ text: s.text.slice(at, from), mark: false });
			out.push({ text: s.text.slice(from, to), mark: true });
			at = to;
		}
		if (at < s.text.length) out.push({ text: s.text.slice(at), mark: false });
		return out;
	}
</script>

<div class="page wide">
	<h1>Search</h1>
	<form class="box" role="search" onsubmit={(e) => e.preventDefault()}>
		<Icon name="search" size={18} />
		<label class="sr-only" for="search-q">Search notes</label>
		<input
			id="search-q"
			bind:this={input}
			bind:value={query}
			type="search"
			placeholder="Words or “an exact phrase”"
			autocomplete="off"
			spellcheck="false"
		/>
	</form>

	{#if !debounced.trim()}
		<p class="hint">
			Every word must appear in a file; quote a phrase to match it exactly. Searches titles, body
			text, properties, drawers and code blocks.
		</p>
	{:else}
		{#if nodes.length}
			<section aria-labelledby="nodes-h">
				<h2 id="nodes-h">Notes</h2>
				<ul class="nodes">
					{#each nodes as hit (hit.id)}
						{@const node = app.vault.node(hit.id)}
						{#if node}
							<li>
								<a href={href.node(hit.id)}>
									<Icon name="file" size={15} />
									<span class="t">{node.title}</span>
									{#if node.olp.length}<span class="olp">{node.olp.join(' › ')}</span>{/if}
								</a>
							</li>
						{/if}
					{/each}
				</ul>
			</section>
		{/if}

		<section aria-labelledby="text-h">
			<h2 id="text-h">
				In text <span class="count" role="status"
					>{total}
					{total === 1 ? 'match' : 'matches'} in {files.length}
					{files.length === 1 ? 'file' : 'files'}</span
				>
			</h2>
			{#if files.length === 0}
				<p class="hint">No file contains all of those words.</p>
			{:else}
				<ol class="files">
					{#each files as file (file.path)}
						<li class="file">
							<div class="head">
								{#if file.nodeId}<a href={href.node(file.nodeId)}>{file.title}</a>{:else}<span
										>{file.title}</span
									>{/if}
								<span class="path">{file.path}</span>
							</div>
							<ul class="snips">
								{#each file.snippets as s (s.line)}
									<li>
										<a href={s.nodeId ? href.node(s.nodeId) : undefined}>
											<span class="ln">{s.line}</span>
											<span class="txt"
												>{#each parts(s) as part, i (i)}{#if part.mark}<mark>{part.text}</mark
														>{:else}{part.text}{/if}{/each}</span
											>
										</a>
									</li>
								{/each}
							</ul>
							{#if file.more > 0}<p class="more">
									+{file.more} more {file.more === 1 ? 'line' : 'lines'}
								</p>{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	{/if}
</div>

<style>
	.wide {
		max-width: 52rem;
	}
	.box {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		height: 3.2rem;
		margin-bottom: 1.75rem;
		padding: 0 1rem;
		border: 1px solid var(--border-strong);
		border-radius: 14px;
		background: var(--surface);
		box-shadow: var(--shadow-sm);
		color: var(--text-muted);
	}
	.box:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.box input {
		flex: 1;
		min-width: 0;
		height: 100%;
		border: 0;
		background: none;
		color: var(--text);
		font-size: 1.05rem;
		outline: none;
	}
	.hint {
		color: var(--text-muted);
		font-size: 0.9rem;
	}
	h2 {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		margin: 0 0 0.75rem;
		color: var(--text-faint);
		font-size: 0.72rem;
		font-weight: 650;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}
	.count {
		color: var(--text-muted);
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
	}
	section + section {
		margin-top: 2rem;
	}
	ul,
	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.nodes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.nodes a {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.88rem;
		font-weight: 550;
		text-decoration: none;
	}
	.nodes a:hover {
		border-color: var(--accent);
	}
	.olp {
		color: var(--text-muted);
		font-size: 0.78rem;
		font-weight: 450;
	}
	.file {
		padding: 0.9rem 0;
		border-top: 1px solid var(--border);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.6rem;
		margin-bottom: 0.4rem;
	}
	.head a,
	.head span:first-child {
		color: var(--text);
		font-family: var(--font-read);
		font-size: 1.12rem;
		font-weight: 600;
		text-decoration: none;
	}
	.head a:hover {
		color: var(--accent);
	}
	.path {
		color: var(--text-faint);
		font-family: var(--font-mono);
		font-size: 0.72rem;
	}
	.snips a {
		display: grid;
		grid-template-columns: 2.6rem minmax(0, 1fr);
		gap: 0.5rem;
		padding: 0.25rem 0.4rem;
		border-radius: 7px;
		color: var(--text-2);
		font-size: 0.86rem;
		line-height: 1.5;
		text-decoration: none;
	}
	.snips a[href]:hover {
		background: var(--surface-2);
	}
	.ln {
		color: var(--text-faint);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		text-align: right;
		padding-top: 0.15rem;
	}
	.txt {
		overflow-wrap: anywhere;
	}
	mark {
		padding: 0 0.1em;
		border-radius: 3px;
		background: color-mix(in oklab, var(--warning, #e0b050) 40%, transparent);
		color: inherit;
	}
	.more {
		margin: 0.2rem 0 0 3.5rem;
		color: var(--text-muted);
		font-size: 0.78rem;
	}
</style>
