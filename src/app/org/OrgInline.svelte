<script lang="ts">
	import type { OrgNode } from '$lib/org';
	import { app } from '../state.svelte';
	import { href } from '../router.svelte';
	import Self from './OrgInline.svelte';
	import { SAFE_SCHEMES, type RenderContext } from './context';
	import { math, texOf } from './math';
	import OrgImage from './OrgImage.svelte';
	import { isImageFile, radioTargets, resolvePath, splitSearch, splitTargets } from '$lib/org';
	import type { Mention } from '$lib/vault/mentions';

	let { nodes, ctx }: { nodes: OrgNode[]; ctx: RenderContext } = $props();

	type Target =
		| { kind: 'node'; id: string; href: string; title: string }
		| { kind: 'page'; href: string; title: string }
		| { kind: 'external'; href: string }
		| { kind: 'broken' }
		| { kind: 'other' };

	/** Same-file links (`[[*Heading]]`, `[[#id]]`, `[[target]]`) and links into other files. */
	function target(linkType: string, path: string): Target {
		void app.rev;
		if (linkType === 'id') {
			const [id = '', search = null] = path.split(/::(.*)/s);
			const node = app.vault.node(id);
			if (!node) return { kind: 'broken' };
			if (!search)
				return { kind: 'node', id: node.id, href: href.node(node.id), title: node.title };
			const t = app.linkTarget(node.file, search);
			return t ? { kind: 'page', ...t } : { kind: 'broken' };
		}
		if (linkType === 'roam') {
			const id = app.vault.resolve({ type: 'roam', dest: path });
			return id
				? { kind: 'node', id, href: href.node(id), title: app.vault.node(id)?.title ?? path }
				: { kind: 'broken' };
		}
		// `[[~/x.org]]` and `[[/x.org]]` parse as fuzzy but are file links.
		const fileLike = linkType === 'fuzzy' && /^(?:~|\.{0,2}\/)/.test(path);
		if (linkType === 'file' || fileLike) {
			const { file, search } = splitSearch(path);
			if (!/\.org$/i.test(file)) return { kind: 'other' };
			const resolved = resolvePath(ctx.path, file);
			const t =
				resolved === null
					? null
					: app.linkTarget(resolved, search ? path.slice(path.indexOf('::') + 2) : null);
			if (!t) return { kind: 'broken' };
			const node = !search && resolved ? app.vault.fileNode(resolved) : undefined;
			return node ? { kind: 'node', id: node.id, ...t } : { kind: 'page', ...t };
		}
		if (linkType === 'fuzzy' || linkType === 'custom-id') {
			const search = linkType === 'custom-id' ? `#${path}` : path;
			const t = app.linkTarget(ctx.path, search);
			return t ? { kind: 'page', ...t } : { kind: 'broken' };
		}
		if (SAFE_SCHEMES.has(linkType)) return { kind: 'external', href: `${linkType}:${path}` };
		return { kind: 'other' };
	}

	/** A link shown as an inline image (org-link-preview's rules), or `null`. */
	function imageOf(
		node: OrgNode,
	): { linkType: 'file' | 'attachment'; path: string; offset: number } | null {
		if (node.type !== 'link') return null;
		if (node.linkType !== 'file' && node.linkType !== 'attachment') return null;
		if (!isImageFile(node.path)) return null;
		return { linkType: node.linkType, path: node.path, offset: node.position?.start.offset ?? 0 };
	}

	/** A description that is a single explicit image link: a clickable image. */
	function imageDescription(node: OrgNode) {
		if (node.type !== 'link' || node.children.length !== 1) return null;
		const inner = node.children[0] as OrgNode;
		if (inner.type !== 'link' || inner.format === 'bracket') return null;
		return imageOf(inner);
	}

	/** Words in this file that are radio targets (`<<<word>>>`) become links to them. */
	const radios = $derived.by(() => {
		void app.rev;
		const source = app.vault.file(ctx.path)?.source;
		const names = source ? radioTargets(source) : [];
		if (!names.length) return null;
		const sorted = [...names].sort((a, b) => b.length - a.length);
		return new RegExp(
			`(?<![\\p{L}\\p{N}])(${sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`,
			'giu',
		);
	});

	/** Link suggestions in this file (sorted), when they're shown here. */
	const mentions = $derived.by((): Mention[] => {
		if (!ctx.mentions || !ctx.interactive || !app.mentionMarks) return [];
		void app.rev;
		return app.mentionsIn(ctx.path, ctx.mentions.range);
	});

	/** The suggestions inside a text node (checked against its text). */
	function mentionsIn(node: OrgNode): Mention[] {
		if (!mentions.length || node.type !== 'text') return [];
		const start = node.position?.start.offset;
		if (start === undefined) return [];
		const end = start + node.value.length;
		return mentions.filter(
			(m) =>
				m.from >= start && m.to <= end && node.value.slice(m.from - start, m.to - start) === m.text,
		);
	}

	type Piece =
		| { kind: 'text'; text: string }
		| { kind: 'target'; name: string }
		| { kind: 'radio'; name: string }
		| { kind: 'radio-link'; text: string }
		| { kind: 'mention'; mention: Mention };

	/** A text node in pieces: link suggestions first, then targets and radio links. */
	function pieces(node: OrgNode & { type: 'text' }): Piece[] {
		const found = mentionsIn(node);
		if (!found.length) return textPieces(node.value);
		const start = node.position?.start.offset ?? 0;
		const out: Piece[] = [];
		let last = 0;
		for (const m of found) {
			out.push(...textPieces(node.value.slice(last, m.from - start)));
			out.push({ kind: 'mention', mention: m });
			last = m.to - start;
		}
		out.push(...textPieces(node.value.slice(last)));
		return out;
	}

	function textPieces(value: string) {
		const out: Piece[] = [];
		if (!value) return out;
		for (const piece of splitTargets(value)) {
			if (piece.kind !== 'text' || !radios) {
				out.push(piece);
				continue;
			}
			let last = 0;
			radios.lastIndex = 0;
			for (let m = radios.exec(piece.text); m; m = radios.exec(piece.text)) {
				if (m.index > last) out.push({ kind: 'text', text: piece.text.slice(last, m.index) });
				out.push({ kind: 'radio-link', text: m[0] });
				last = m.index + m[0].length;
			}
			if (last < piece.text.length) out.push({ kind: 'text', text: piece.text.slice(last) });
		}
		return out;
	}
</script>

{#each nodes as node, i (i)}
	{#if node.type === 'text'}{#if !node.value.includes('<<') && !radios && !mentionsIn(node).length}{node.value}{:else}{#each pieces(node) as piece, k (k)}{#if piece.kind === 'text'}{piece.text}{:else if piece.kind === 'mention'}{@const m =
						piece.mention}<button
						type="button"
						class="mention"
						aria-haspopup="menu"
						aria-label={`${m.text}, a mention of ${m.title} (link suggestion)`}
						onclick={(e) =>
							(app.mentionMenu = {
								path: ctx.path,
								mention: m,
								anchor: e.currentTarget as HTMLElement,
							})}>{m.text}</button
					>{:else if piece.kind === 'target'}<span
						class="org-target"
						data-target={piece.name.toLowerCase()}
					></span>{:else if piece.kind === 'radio'}<span
						class="org-target radio"
						data-target={piece.name.toLowerCase()}>{piece.name}</span
					>{:else}{@const t = app.linkTarget(ctx.path, piece.text)}<a
						class="ilink radio-link"
						href={t?.href ?? null}>{piece.text}</a
					>{/if}{/each}{/if}{:else if node.type === 'bold'}<strong
			><Self nodes={node.children} {ctx} /></strong
		>
	{:else if node.type === 'italic'}<em><Self nodes={node.children} {ctx} /></em>
	{:else if node.type === 'underline'}<span class="u"><Self nodes={node.children} {ctx} /></span>
	{:else if node.type === 'strike-through'}<s><Self nodes={node.children} {ctx} /></s>
	{:else if node.type === 'code' || node.type === 'verbatim'}<code>{node.value}</code>
	{:else if node.type === 'link' && !node.children.length && imageOf(node)}
		{@const img = imageOf(node)!}
		<OrgImage linkType={img.linkType} path={img.path} offset={img.offset} {ctx} />
	{:else if node.type === 'link' && imageDescription(node)}
		{@const img = imageDescription(node)!}
		{@const t = target(node.linkType, node.path)}
		<a
			class="img-link"
			href={t.kind === 'node' || t.kind === 'page' || t.kind === 'external' ? t.href : null}
			target={t.kind === 'external' ? '_blank' : null}
			rel={t.kind === 'external' ? 'noopener noreferrer' : null}
			><OrgImage linkType={img.linkType} path={img.path} offset={img.offset} {ctx} /></a
		>
	{:else if node.type === 'link'}
		{@const t = target(node.linkType, node.path)}
		{#if t.kind === 'page'}
			<a class="ilink" href={t.href} title={t.title}
				>{#if node.children.length}<Self nodes={node.children} {ctx} />{:else}{t.title}{/if}</a
			>
		{:else if t.kind === 'node'}
			<a class="ilink" class:self={t.id === ctx.highlight} href={t.href} title={t.title}
				>{#if node.children.length}<Self nodes={node.children} {ctx} />{:else}{t.title}{/if}</a
			>
		{:else if t.kind === 'external'}
			<a class="xlink" href={t.href} target="_blank" rel="noopener noreferrer"
				>{#if node.children.length}<Self nodes={node.children} {ctx} />{:else}{node.path}{/if}<span
					class="sr-only"
				>
					(opens in a new tab)</span
				></a
			>
		{:else if t.kind === 'broken'}
			<span class="blink" title="This note isn't in the vault"
				>{#if node.children.length}<Self
						nodes={node.children}
						{ctx}
					/>{:else}{node.rawLink}{/if}</span
			>
		{:else}
			<span class="olink" title={node.rawLink}
				>{#if node.children.length}<Self
						nodes={node.children}
						{ctx}
					/>{:else}{node.rawLink}{/if}</span
			>
		{/if}
	{:else if node.type === 'timestamp'}<time
			class="ts"
			class:inactive={node.timestampType.startsWith('inactive')}
			>{node.rawValue.replace(/^[<[]|[>\]]$/g, '')}</time
		>
	{:else if node.type === 'entity'}{node.utf8}
	{:else if node.type === 'line-break'}<br />
	{:else if node.type === 'superscript'}<sup><Self nodes={node.children} {ctx} /></sup>
	{:else if node.type === 'subscript'}<sub><Self nodes={node.children} {ctx} /></sub>
	{:else if node.type === 'statistics-cookie'}<span class="cookie" title="Progress"
			>{node.value.replace(/^\[|\]$/g, '')}</span
		>
	{:else if node.type === 'footnote-reference'}<sup class="fn"
			><a href={`#fn-${node.label}`} id={`fnref-${node.label}`}>{node.label}</a></sup
		>
	{:else if node.type === 'latex-fragment'}{@const tex = texOf(node.value)}{#if tex}<span
				class="math"
				class:display={tex.display}
				use:math={{ ...tex, source: node.value }}
			></span>{:else}<code class="latex">{node.value}</code>{/if}
	{:else if node.type === 'citation'}<span class="cite">[<Self nodes={node.children} {ctx} />]</span
		>
	{:else if node.type === 'citation-reference'}<Self nodes={node.children} {ctx} />
	{:else if node.type === 'citation-key'}@{node.key}
	{:else if 'children' in node && Array.isArray(node.children)}<Self
			nodes={node.children as OrgNode[]}
			{ctx}
		/>
	{/if}
{/each}
