<script lang="ts">
	// `#+transclude:` (org-transclusion): another note, a part of one, or a
	// text file, shown in place and read-only, with a link to where it lives.
	import {
		owningHeadline,
		parseOrg,
		parseTransclude,
		resolvePath,
		splitSearch,
		transcludedText,
		type OrgNode,
		type TranscludePart,
	} from '$lib/org';
	import Icon from '../components/Icon.svelte';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import Blocks from './OrgBlocks.svelte';
	import type { RenderContext } from './context';

	let { value, offset, ctx }: { value: string; offset: number; ctx: RenderContext } = $props();

	const opts = $derived(parseTransclude(value));

	/** The file to read, which part of it, and where the "from" link goes. */
	const target = $derived.by(() => {
		void app.rev;
		if (!opts) return null;
		const link = opts.link;
		if (link.startsWith('id:')) {
			const [id = '', search] = link.slice(3).split(/::(.*)/s);
			const node = app.vault.node(id);
			if (!node) return null;
			const part: TranscludePart = search
				? { kind: 'search', search }
				: node.level > 0
					? { kind: 'subtree', offset: node.pos }
					: { kind: 'file' };
			return {
				path: node.file,
				part,
				org: true,
				title: node.title,
				link: href.node(node.id, search ?? null),
			};
		}
		const { file, search } = splitSearch(link.replace(/^file:/, ''));
		const path = resolvePath(ctx.path, file);
		if (path === null) return null;
		const org = /\.org$/i.test(path);
		const part: TranscludePart =
			search && org
				? { kind: 'search', search: link.slice(link.indexOf('::') + 2) }
				: { kind: 'file' };
		const t = org ? app.linkTarget(path, search ? link.slice(link.indexOf('::') + 2) : null) : null;
		return { path, part, org, title: t?.title ?? path, link: t?.href ?? null };
	});

	// Org notes come from the vault; other files (code, text) are read from storage.
	let other = $state<string | null>(null);
	$effect(() => {
		const t = target;
		other = null;
		if (!t || t.org) return;
		let cancelled = false;
		void app.readText(t.path).then((text) => {
			if (!cancelled) other = text;
		});
		return () => (cancelled = true);
	});

	const key = $derived(target ? `${target.path}::${opts?.link}` : '');
	const looped = $derived(!!target && (ctx.transcluding ?? []).includes(key));

	const nodes = $derived.by((): OrgNode[] | null => {
		void app.rev;
		if (!opts || !target || looped || (ctx.transcluding?.length ?? 0) >= 4) return null;
		const file = target.org ? app.vault.file(target.path) : null;
		const source = target.org ? file?.source : other;
		if (source == null) return null;
		const host = app.vault.file(ctx.path);
		const hostLevel = host
			? (owningHeadline(host.source, offset, host.index.keywords)?.level ?? 0)
			: 0;
		const text = transcludedText(source, target.part, opts, {
			org: target.org,
			hostLevel,
			...(file ? { keywords: file.index.keywords } : {}),
		});
		if (text === null) return null;
		return (
			target.org || opts.src
				? parseOrg(text, file?.index.keywords)
				: parseOrg(`#+begin_example\n${text.replace(/\n?$/, '\n')}#+end_example\n`)
		).children as OrgNode[];
	});
</script>

<aside
	class="transclusion"
	aria-label={`Transcluded from ${target?.title ?? opts?.link ?? 'a link'}`}
>
	<p class="from">
		<Icon name="link" size={13} />
		{#if target?.link}<a href={target.link}>{target.title}</a>{:else}{target?.title ??
				opts?.link ??
				value}{/if}
	</p>
	{#if nodes}
		<div class="content">
			<Blocks
				{nodes}
				ctx={{
					path: target!.path,
					levelOffset: ctx.levelOffset,
					interactive: false,
					transcluding: [...(ctx.transcluding ?? []), key],
				}}
			/>
		</div>
	{:else if looped}
		<p class="note">This transclusion includes itself.</p>
	{:else if target && !target.org && other === null}
		<p class="note">Loading…</p>
	{:else}
		<p class="note">Nothing to transclude: the link's target isn't in this vault.</p>
	{/if}
</aside>

<style>
	.transclusion {
		margin: 1em 0;
		padding: 0.2rem 0 0.2rem 0.9rem;
		border-left: 3px solid color-mix(in oklab, var(--accent) 45%, transparent);
	}
	.from {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0 0 0.3rem;
		color: var(--text-muted);
		font: 600 0.75rem/1.3 var(--font-ui);
	}
	.from a {
		color: var(--link);
	}
	.note {
		margin: 0;
		color: var(--text-faint);
		font-size: 0.85rem;
	}
</style>
