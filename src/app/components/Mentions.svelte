<script lang="ts">
	// Link suggestions for the note on screen: other notes' titles written in
	// it as plain text. Link one, link them all (one Undo), or stop suggesting
	// a note. The same suggestions are underlined in the text.
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	let { path, range }: { path: string; range?: [number, number] | undefined } = $props();
	const uid = $props.id();

	const found = $derived.by(() => {
		void app.rev;
		return app.mentionsIn(path, range);
	});
	/** Each suggestion's line, cut to fit, with the words marked. */
	const lines = $derived.by(() => {
		const source = app.vault.file(path)?.source ?? '';
		return found.map((m) => {
			const start = source.lastIndexOf('\n', m.from - 1) + 1;
			const end = source.indexOf('\n', m.to);
			const before = source.slice(start, m.from);
			const after = source.slice(m.to, end === -1 ? undefined : end);
			return {
				m,
				before: before.length > 50 ? `…${before.slice(-50)}` : before,
				after: after.length > 70 ? `${after.slice(0, 70)}…` : after,
			};
		});
	});
</script>

{#if found.length}
	<section class="panel-section mentions" aria-labelledby={`${uid}-h`}>
		<h2 id={`${uid}-h`} class="panel-title">
			<Icon name="link" size={15} />
			Link suggestions
			<span class="count">{found.length}</span>
		</h2>
		<ul>
			{#each lines as { m, before, after } (`${m.from}:${m.id}`)}
				<li>
					<a class="to" href={href.node(m.id)}>{m.title}</a>
					<p class="line">{before}<mark>{m.text}</mark>{after}</p>
					<div class="acts">
						<button
							type="button"
							class="btn small"
							aria-label={`Link “${m.text}” to ${m.title}`}
							onclick={() => app.linkMention(path, m.from, m.text, m.id)}>Link</button
						>
						<button
							type="button"
							class="btn small icon-only ghost"
							aria-label={`Don’t suggest ${m.title}`}
							title={`Don’t suggest ${m.title}`}
							onclick={() => void app.ignoreMention(m.id)}><Icon name="close" size={13} /></button
						>
					</div>
				</li>
			{/each}
		</ul>
		{#if found.length > 1}
			<button type="button" class="btn small all" onclick={() => app.linkMentions(path, found)}
				>Link all {found.length}</button
			>
		{/if}
	</section>
{/if}

<style>
	.mentions {
		margin-top: 1.75rem;
	}
	.panel-title {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0 0 0.75rem;
		color: var(--text-muted);
		font-size: 0.75rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.count {
		margin-left: auto;
		min-width: 1.5rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-muted);
		font-size: 0.7rem;
		text-align: center;
		letter-spacing: 0;
	}
	ul {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.15rem 0.5rem;
		align-items: start;
	}
	.to {
		color: var(--link);
		font-size: 0.82rem;
		font-weight: 600;
	}
	.line {
		grid-column: 1;
		margin: 0;
		color: var(--text-muted);
		font-size: 0.84rem;
		overflow-wrap: anywhere;
	}
	.acts {
		display: flex;
		gap: 0.2rem;
		grid-column: 2;
		grid-row: 1 / span 2;
	}
	mark {
		background: color-mix(in oklab, var(--accent) 18%, transparent);
		color: var(--text);
	}
	.all {
		margin-top: 0.75rem;
	}
</style>
