<script lang="ts">
	// An inline image from a `file:` or `attachment:` link, read from the vault
	// (the working tree, the folder on disk, or the cloud service, cached).
	import { attachmentCandidates, resolvePath } from '$lib/org';
	import { app } from '../state.svelte';
	import type { RenderContext } from './context';

	let {
		linkType,
		path,
		offset,
		ctx,
		alt = '',
	}: {
		linkType: 'file' | 'attachment';
		path: string;
		/** Where the link is in the file (attachments belong to the entry around it). */
		offset: number;
		ctx: RenderContext;
		alt?: string;
	} = $props();

	const candidates = $derived.by((): string[] => {
		const clean = path.replace(/::.*$/, '');
		if (linkType === 'file') {
			const p = resolvePath(ctx.path, clean);
			return p === null ? [] : [p];
		}
		const file = app.vault.file(ctx.path);
		return file
			? attachmentCandidates(file.source, offset, ctx.path, clean, file.index.keywords)
			: [];
	});

	let url = $state<string | null>(null);
	let missing = $state(false);

	$effect(() => {
		const list = candidates;
		let cancelled = false;
		url = null;
		missing = false;
		void (async () => {
			for (const p of list) {
				const u = await app.fileUrl(p);
				if (cancelled) return;
				if (u) {
					url = u;
					return;
				}
			}
			if (!cancelled) missing = true;
		})();
		return () => (cancelled = true);
	});

	const width = $derived(ctx.image?.width ?? null);
	const label = $derived(alt || path.split('/').pop() || path);
</script>

{#if url}
	<img
		class="org-img"
		class:center={ctx.image?.align === 'center'}
		class:right={ctx.image?.align === 'right'}
		src={url}
		alt={label}
		style:width
		loading="lazy"
		decoding="async"
	/>
{:else if missing}
	<span class="img-missing" title={candidates[0] ?? path}>🖼 {label} (not found)</span>
{:else}
	<span class="img-loading" aria-label={`Loading ${label}`}></span>
{/if}

<style>
	.org-img {
		display: inline-block;
		max-width: 100%;
		height: auto;
		border-radius: 6px;
		vertical-align: middle;
	}
	.org-img.center {
		display: block;
		margin: 0.5em auto;
	}
	.org-img.right {
		display: block;
		margin: 0.5em 0 0.5em auto;
	}
	.img-missing {
		color: var(--text-muted);
		font-size: 0.9em;
	}
	.img-loading {
		display: inline-block;
		width: 4rem;
		height: 2.5rem;
		border-radius: 6px;
		background: var(--surface-2);
		vertical-align: middle;
	}
</style>
