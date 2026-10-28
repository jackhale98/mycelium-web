<script lang="ts">
	// A long note's headings, to jump around: in the side panel on wide
	// screens, and as a collapsible list at the top of the note otherwise.
	export interface TocEntry {
		pos: number;
		level: number;
		title: string;
		todo: string | null;
	}

	let {
		entries,
		baseLevel,
		container,
		variant,
	}: {
		entries: TocEntry[];
		/** The note's own level: its first sub-headings are indented 0. */
		baseLevel: number;
		/** Where the note's sections are. */
		container: () => HTMLElement | undefined;
		variant: 'inline' | 'panel';
	} = $props();

	let open = $state(false);
	const top = $derived(Math.min(...entries.map((e) => e.level)));

	function go(e: MouseEvent, entry: TocEntry) {
		e.preventDefault();
		const section = container()?.querySelector<HTMLElement>(
			`.org-section[data-pos="${entry.pos}"]`,
		);
		// A folded parent hides it: go to the nearest one that shows.
		let target: HTMLElement | null = section ?? null;
		while (target && target.getBoundingClientRect().height === 0)
			target = target.parentElement?.closest<HTMLElement>('.org-section') ?? null;
		if (!target) return;
		target.scrollIntoView({ block: 'start', behavior: 'smooth' });
		target
			.querySelector<HTMLElement>(
				'.heading-row h2, .heading-row h3, .heading-row h4, .heading-row h5, .heading-row h6',
			)
			?.focus({ preventScroll: true });
		if (variant === 'inline') open = false;
	}
</script>

{#snippet list()}
	<ol>
		{#each entries as entry (entry.pos)}
			<li style:padding-left={`${(entry.level - top) * 0.85}rem`}>
				<a href={`#h-${entry.pos}`} onclick={(e) => go(e, entry)}
					>{#if entry.todo}<span class="todo">{entry.todo}</span>{/if}{entry.title}</a
				>
			</li>
		{/each}
	</ol>
{/snippet}

{#if variant === 'panel'}
	<nav class="toc panel" aria-label="Contents">
		<h2 class="title">Contents</h2>
		{@render list()}
	</nav>
{:else}
	<details class="toc inline" bind:open data-base={baseLevel}>
		<summary>Contents <span class="count">{entries.length}</span></summary>
		{@render list()}
	</details>
{/if}

<style>
	.toc ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.toc li a {
		display: block;
		padding: 0.25rem 0.5rem;
		border-radius: 7px;
		color: var(--text-2);
		font-size: 0.86rem;
		line-height: 1.35;
		text-decoration: none;
	}
	.toc li a:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.todo {
		margin-right: 0.35rem;
		color: var(--todo);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.03em;
	}
	.panel {
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border);
	}
	.title {
		margin: 0 0 0.5rem;
		color: var(--text-muted);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.inline {
		margin: 0 0 1.25rem;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
	}
	.inline summary {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.25rem;
		color: var(--text-2);
		font-size: 0.86rem;
		font-weight: 650;
		cursor: pointer;
	}
	.inline[open] summary {
		margin-bottom: 0.25rem;
	}
	.count {
		color: var(--text-faint);
		font-weight: 600;
	}
	@media (pointer: coarse) {
		.toc li a {
			padding-block: 0.55rem;
		}
	}
</style>
