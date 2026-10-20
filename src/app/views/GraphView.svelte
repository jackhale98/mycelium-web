<script lang="ts">
	import { drag } from 'd3-drag';
	import {
		forceCenter,
		forceCollide,
		forceLink,
		forceManyBody,
		forceSimulation,
		forceX,
		forceY,
		type Simulation,
		type SimulationLinkDatum,
		type SimulationNodeDatum,
	} from 'd3-force';
	import { select } from 'd3-selection';
	import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
	import { buildGraph, type GraphNode } from '$lib/vault/graph';
	import Icon from '../components/Icon.svelte';
	import { href, router } from '../router.svelte';
	import { app } from '../state.svelte';

	let { focus = null }: { focus?: string | null } = $props();

	type SimNode = GraphNode & SimulationNodeDatum & { r: number };
	type SimLink = SimulationLinkDatum<SimNode> & { weight: number };

	const PREFS_KEY = 'mycelium:graph';
	function loadPrefs() {
		try {
			return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
		} catch {
			return {};
		}
	}
	const prefs = loadPrefs();
	let dailies = $state(prefs['dailies'] !== false);
	let orphans = $state(prefs['orphans'] !== false);
	let headings = $state(prefs['headings'] === true);
	let depth = $state(typeof prefs['depth'] === 'number' ? (prefs['depth'] as number) : 2);
	let local = $state(true);
	/** Phones: the controls live in a collapsible footer. */
	let expanded = $state(prefs['expanded'] === true);
	let narrow = $state(
		typeof matchMedia !== 'undefined' && matchMedia('(max-width: 720px)').matches,
	);
	/** Phones have no hover: the first tap selects a node, the second (or Open) opens it. */
	let selected = $state<SimNode | null>(null);
	let controlsEl: HTMLDivElement | undefined = $state();
	$effect(() => {
		const mq = matchMedia('(max-width: 720px)');
		const on = () => (narrow = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});
	let filter = $state('');
	$effect(() => {
		try {
			localStorage.setItem(
				PREFS_KEY,
				JSON.stringify({ dailies, orphans, headings, depth, expanded }),
			);
		} catch {
			/* per-session only */
		}
	});

	let host: HTMLDivElement | undefined = $state();
	let canvas: HTMLCanvasElement | undefined = $state();
	let hovered = $state<SimNode | null>(null);

	const graph = $derived.by(() => {
		void app.rev;
		return buildGraph(app.vault, {
			collapseHeadings: !headings,
			includeDailies: dailies,
			includeOrphans: orphans,
			isDaily: (p) => app.isDaily(p),
			focus: local ? focus : null,
			depth,
		});
	});
	const focusNode = $derived(focus ? app.vault.node(focus) : undefined);
	const ranked = $derived(
		[...graph.nodes].sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title)),
	);
	/** The vault's most-used tags, so colours stay put between views. */
	const topTags = $derived.by(() => {
		void app.rev;
		return [...app.vault.tags.entries()]
			.sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
			.slice(0, 7)
			.map(([t]) => t);
	});

	$effect(() => {
		document.title = `${focusNode && local ? `${focusNode.title} · ` : ''}Graph · Mycelium`;
	});

	// ---------------------------------------------------------------- drawing

	const LIGHT = ['#3f6b3a', '#b8862a', '#4d7399', '#a0564f', '#76589c', '#2f8079', '#8a6d3b'];
	const DARK = ['#8fc48a', '#e0b050', '#86acd6', '#e08a80', '#b49ad8', '#6cc4ba', '#d0a874'];
	let palette = {
		tags: LIGHT,
		text: '#222',
		muted: '#888',
		link: 'rgba(0,0,0,.12)',
		node: '#999',
		accent: '#2e4a2b',
		bg: '#fff',
		ring: '#e0b050',
	};

	function readPalette() {
		const css = getComputedStyle(document.documentElement);
		const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
		const dark =
			document.documentElement.dataset.theme === 'dark' ||
			(!document.documentElement.dataset.theme &&
				matchMedia('(prefers-color-scheme: dark)').matches);
		palette = {
			tags: dark ? DARK : LIGHT,
			text: v('--text', '#222'),
			muted: v('--text-muted', '#888'),
			link: dark ? 'rgba(241,234,214,0.13)' : 'rgba(46,74,43,0.16)',
			node: v('--text-faint', '#999'),
			accent: v('--accent', '#2e4a2b'),
			bg: v('--bg', '#fff'),
			ring: dark ? '#e0b050' : '#b8862a',
		};
	}

	let sim: Simulation<SimNode, SimLink> | null = null;
	let nodes: SimNode[] = [];
	let links: SimLink[] = [];
	let neighbours = new Map<string, Set<string>>();
	let transform: ZoomTransform = zoomIdentity;
	let zoomer: ZoomBehavior<HTMLCanvasElement, unknown> | null = null;
	let size = { w: 800, h: 600 };
	let frame = 0;
	/** Once the person pans or zooms, stop fitting the view for them. */
	let userMoved = false;

	const colorOf = (n: SimNode) => {
		if (n.daily) return palette.node;
		const i = n.tag ? topTags.indexOf(n.tag) : -1;
		return i >= 0 ? palette.tags[i % palette.tags.length]! : palette.accent;
	};

	function draw() {
		frame = 0;
		const ctx = canvas?.getContext('2d');
		if (!ctx || !canvas) return;
		const dpr = devicePixelRatio || 1;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, size.w, size.h);
		ctx.translate(transform.x, transform.y);
		ctx.scale(transform.k, transform.k);

		const q = filter.trim().toLowerCase();
		const active = hovered;
		const near = active ? (neighbours.get(active.id) ?? new Set<string>()) : null;
		const lit = (n: SimNode) =>
			(!near || n === active || near.has(n.id)) && (!q || n.title.toLowerCase().includes(q));

		for (const l of links) {
			const s = l.source as SimNode;
			const t = l.target as SimNode;
			const on = active && (s === active || t === active);
			ctx.globalAlpha = active ? (on ? 0.9 : 0.15) : q ? 0.35 : 1;
			ctx.strokeStyle = on ? palette.ring : palette.link;
			ctx.lineWidth = (on ? 1.6 : 0.8 + Math.min(l.weight, 4) * 0.35) / Math.sqrt(transform.k);
			ctx.beginPath();
			ctx.moveTo(s.x!, s.y!);
			ctx.lineTo(t.x!, t.y!);
			ctx.stroke();
		}

		for (const n of nodes) {
			ctx.globalAlpha = lit(n) ? 1 : 0.18;
			ctx.fillStyle = colorOf(n);
			ctx.beginPath();
			ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
			ctx.fill();
			if (n.distance === 0 || n === active) {
				ctx.lineWidth = 2.2 / transform.k;
				ctx.strokeStyle = palette.ring;
				ctx.beginPath();
				ctx.arc(n.x!, n.y!, n.r + 3.5 / transform.k, 0, Math.PI * 2);
				ctx.stroke();
			}
		}

		// Labels: hubs always, everything when zoomed in, neighbours of the hovered node.
		const hub = Math.max(3, (ranked[Math.min(14, ranked.length - 1)]?.degree ?? 3) || 3);
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		for (const n of nodes) {
			const show =
				n === active ||
				(near
					? near.has(n.id)
					: (n.degree >= hub && transform.k > 0.45) || transform.k > 1.6 || n.distance === 0) ||
				(q && n.title.toLowerCase().includes(q));
			if (!show) continue;
			const fs =
				(n === active || n.distance === 0 ? 13 : 11) / Math.max(0.8, Math.sqrt(transform.k));
			ctx.font = `${n === active || n.distance === 0 ? 650 : 500} ${fs}px Inter Variable, system-ui, sans-serif`;
			ctx.globalAlpha = lit(n) ? 1 : 0.3;
			const label = n.title.length > 38 ? `${n.title.slice(0, 36)}…` : n.title;
			ctx.lineWidth = 3 / transform.k;
			ctx.strokeStyle = palette.bg;
			ctx.strokeText(label, n.x!, n.y! + n.r + 3 / transform.k);
			ctx.fillStyle = n === active ? palette.text : palette.muted;
			ctx.fillText(label, n.x!, n.y! + n.r + 3 / transform.k);
		}
		ctx.globalAlpha = 1;
	}

	const redraw = () => {
		if (!frame) frame = requestAnimationFrame(draw);
	};

	function nodeAt(px: number, py: number): SimNode | null {
		const [x, y] = transform.invert([px, py]);
		let best: SimNode | null = null;
		let bestD = Infinity;
		for (const n of nodes) {
			const d = Math.hypot(n.x! - x, n.y! - y);
			const reach = n.r + 6 / transform.k;
			if (d < reach && d < bestD) {
				best = n;
				bestD = d;
			}
		}
		return best;
	}

	// Rebuild the simulation whenever the graph changes, keeping known positions.
	$effect(() => {
		const g = graph;
		if (!canvas) return;
		const old = new Map(nodes.map((n) => [n.id, n]));
		nodes = g.nodes.map((n) => {
			const prev = old.get(n.id);
			return {
				...n,
				r: 3.5 + Math.sqrt(n.degree) * 2.2,
				...(prev ? { x: prev.x, y: prev.y, vx: 0, vy: 0 } : {}),
			};
		});
		const byId = new Map(nodes.map((n) => [n.id, n]));
		links = g.links.map((l) => ({
			source: byId.get(l.source)!,
			target: byId.get(l.target)!,
			weight: l.weight,
		}));
		neighbours = new Map();
		for (const l of g.links) {
			if (!neighbours.has(l.source)) neighbours.set(l.source, new Set());
			if (!neighbours.has(l.target)) neighbours.set(l.target, new Set());
			neighbours.get(l.source)!.add(l.target);
			neighbours.get(l.target)!.add(l.source);
		}
		const focusSim = g.focus ? byId.get(g.focus) : undefined;
		if (focusSim && focusSim.x === undefined) {
			focusSim.fx = 0;
			focusSim.fy = 0;
		}

		sim?.stop();
		const n = nodes.length;
		sim = forceSimulation<SimNode, SimLink>(nodes)
			.force(
				'link',
				forceLink<SimNode, SimLink>(links)
					.distance((l) => 34 + ((l.source as SimNode).r + (l.target as SimNode).r) * 1.6)
					.strength((l) => Math.min(1, 0.25 + l.weight * 0.12)),
			)
			.force(
				'charge',
				forceManyBody<SimNode>()
					.strength(n > 1500 ? -40 : n > 400 ? -80 : -170)
					.distanceMax(600),
			)
			.force(
				'collide',
				forceCollide<SimNode>((d) => d.r + 3),
			)
			.force('center', forceCenter(0, 0))
			.force('x', forceX<SimNode>(0).strength(0.04))
			.force('y', forceY<SimNode>(0).strength(0.04))
			.on('tick', redraw)
			.on('end', () => {
				if (!userMoved) fit();
			});
		setTimeout(() => {
			if (!userMoved) fit();
		}, 700);
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
			sim.stop();
			sim.tick(300);
			redraw();
		}
		setTimeout(() => {
			if (focusSim) {
				focusSim.fx = null;
				focusSim.fy = null;
			}
		}, 1500);
		return () => sim?.stop();
	});

	// Canvas sizing, zoom, drag, hover and theme tracking.
	$effect(() => {
		if (!canvas || !host) return;
		const el = canvas;
		readPalette();
		const resize = () => {
			const rect = host!.getBoundingClientRect();
			size = { w: rect.width, h: rect.height };
			const dpr = devicePixelRatio || 1;
			el.width = Math.round(rect.width * dpr);
			el.height = Math.round(rect.height * dpr);
			el.style.width = `${rect.width}px`;
			el.style.height = `${rect.height}px`;
			redraw();
		};
		const ro = new ResizeObserver(resize);
		ro.observe(host);
		resize();

		zoomer = zoom<HTMLCanvasElement, unknown>()
			.scaleExtent([0.08, 6])
			.on('zoom', (e: { transform: ZoomTransform; sourceEvent: Event | null }) => {
				if (e.sourceEvent) userMoved = true;
				transform = e.transform;
				redraw();
			});
		const sel = select(el);
		sel.call(
			drag<HTMLCanvasElement, unknown, SimNode | undefined>()
				.container(el)
				.subject((e: { x: number; y: number }) => nodeAt(e.x, e.y) ?? undefined)
				.on('start', (e: { active: number; subject: SimNode }) => {
					if (!e.active) sim?.alphaTarget(0.25).restart();
					e.subject.fx = e.subject.x;
					e.subject.fy = e.subject.y;
				})
				.on('drag', (e: { x: number; y: number; subject: SimNode }) => {
					const [x, y] = transform.invert([e.x, e.y]);
					e.subject.fx = x;
					e.subject.fy = y;
				})
				.on('end', (e: { active: number; subject: SimNode }) => {
					if (!e.active) sim?.alphaTarget(0);
					e.subject.fx = null;
					e.subject.fy = null;
				}),
		);

		// After drag, so dragging a node takes precedence over panning.
		sel.call(zoomer).on('dblclick.zoom', null);
		zoomer.transform(sel, zoomIdentity.translate(size.w / 2, size.h / 2).scale(0.9));

		const move = (e: PointerEvent) => {
			const rect = el.getBoundingClientRect();
			const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
			if (n !== hovered) {
				hovered = n;
				el.style.cursor = n ? 'pointer' : 'grab';
				redraw();
			}
		};
		const leave = () => {
			if (narrow) return;
			hovered = null;
			redraw();
		};
		let down: { x: number; y: number } | null = null;
		const press = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
		const click = (e: MouseEvent) => {
			if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
			const rect = el.getBoundingClientRect();
			const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
			if (narrow) {
				if (n && selected === n) router.go(href.node(n.id));
				else {
					selected = n;
					hovered = n;
					redraw();
				}
			} else if (n) router.go(href.node(n.id));
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerleave', leave);
		el.addEventListener('pointerdown', press);
		el.addEventListener('click', click);

		const mo = new MutationObserver(() => {
			readPalette();
			redraw();
		});
		mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		const mq = matchMedia('(prefers-color-scheme: dark)');
		const onScheme = () => {
			readPalette();
			redraw();
		};
		mq.addEventListener('change', onScheme);
		return () => {
			ro.disconnect();
			mo.disconnect();
			mq.removeEventListener('change', onScheme);
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerleave', leave);
			el.removeEventListener('pointerdown', press);
			el.removeEventListener('click', click);
			sel.on('.zoom', null).on('.drag', null);
			if (frame) cancelAnimationFrame(frame);
		};
	});

	$effect(() => {
		void filter;
		void topTags;
		redraw();
	});

	function fit() {
		if (!canvas || !zoomer || !nodes.length) return;
		const xs = nodes.map((n) => n.x ?? 0);
		const ys = nodes.map((n) => n.y ?? 0);
		const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
		// Leave room for the controls: a side panel on wide screens, a footer on phones.
		const left = size.w > 900 ? 300 : 0;
		const bottom = narrow ? (controlsEl?.offsetHeight ?? 56) + 16 : 0;
		const w = size.w - left;
		const h = size.h - bottom;
		const k = Math.min(2.4, 0.86 / Math.max((x1 - x0 + 80) / w, (y1 - y0 + 80) / h));
		zoomer.transform(
			select(canvas),
			zoomIdentity
				.translate(left + w / 2, h / 2)
				.scale(k)
				.translate(-(x0 + x1) / 2, -(y0 + y1) / 2),
		);
	}
</script>

<div class="graph" bind:this={host}>
	<canvas
		bind:this={canvas}
		role="img"
		aria-label={`Link graph: ${graph.nodes.length} notes and ${graph.links.length} connections. A list of the notes follows.`}
	></canvas>

	<div class="panel controls" class:narrow bind:this={controlsEl}>
		<div class="title-row">
			<h1>Graph</h1>
			<span class="stats">{graph.nodes.length} notes · {graph.links.length} links</span>
			{#if narrow}
				<button
					type="button"
					class="expand"
					aria-expanded={expanded}
					aria-controls="graph-options"
					aria-label={expanded ? 'Hide graph options' : 'Show graph options'}
					onclick={() => (expanded = !expanded)}
					><span class="chev" class:up={expanded}><Icon name="chevronDown" size={18} /></span
					></button
				>
			{/if}
		</div>
		{#if narrow && selected}
			<div class="info" role="status">
				<div class="info-text">
					<strong>{selected.title}</strong>
					<span>{selected.degree} {selected.degree === 1 ? 'link' : 'links'} · {selected.file}</span
					>
				</div>
				<a class="btn small primary" href={href.node(selected.id)}>Open</a>
				<button
					type="button"
					class="expand"
					aria-label="Clear selection"
					onclick={() => {
						selected = null;
						hovered = null;
						redraw();
					}}><Icon name="close" size={15} /></button
				>
			</div>
		{/if}
		<div class="options" id="graph-options" hidden={narrow && !expanded}>
			{#if focusNode}
				<div class="seg" role="radiogroup" aria-label="Scope">
					<button type="button" role="radio" aria-checked={local} onclick={() => (local = true)}
						>Around {focusNode.title.length > 22
							? `${focusNode.title.slice(0, 20)}…`
							: focusNode.title}</button
					>
					<button type="button" role="radio" aria-checked={!local} onclick={() => (local = false)}
						>Whole vault</button
					>
				</div>
				{#if local}
					<label class="depth"
						>Depth
						<input type="range" min="1" max="4" bind:value={depth} />
						<span>{depth}</span></label
					>
				{/if}
			{/if}
			<label class="find">
				<Icon name="search" size={14} />
				<span class="sr-only">Highlight notes</span>
				<input type="search" placeholder="Highlight…" bind:value={filter} />
			</label>
			<div class="toggles">
				<label><input type="checkbox" bind:checked={dailies} /> Dailies</label>
				<label
					><input type="checkbox" bind:checked={orphans} disabled={local && !!focusNode} /> Orphans</label
				>
				<label><input type="checkbox" bind:checked={headings} /> Heading nodes</label>
			</div>
			{#if topTags.length}
				<ul class="legend" aria-label="Colours by tag">
					{#each topTags as tag, i (tag)}
						<li>
							<span class="sw" style:background={palette.tags[i % palette.tags.length]}
							></span>#{tag}
						</li>
					{/each}
				</ul>
			{/if}
			<button
				type="button"
				class="btn small"
				onclick={() => {
					userMoved = false;
					fit();
				}}><Icon name="monitor" size={14} />Fit</button
			>
			{#if narrow}
				<details class="in-list">
					<summary>Notes in view ({ranked.length})</summary>
					<ol>
						{#each ranked.slice(0, 300) as n (n.id)}
							<li><a href={href.node(n.id)}>{n.title}</a> <span>{n.degree}</span></li>
						{/each}
					</ol>
				</details>
			{/if}
		</div>
	</div>

	{#if hovered && !narrow}
		<div class="panel tip" aria-hidden="true">
			<strong>{hovered.title}</strong>
			<span>{hovered.degree} {hovered.degree === 1 ? 'link' : 'links'} · {hovered.file}</span>
		</div>
	{/if}

	<details class="panel list" hidden={narrow}>
		<summary>Notes in view ({ranked.length})</summary>
		<ol>
			{#each ranked.slice(0, 300) as n (n.id)}
				<li><a href={href.node(n.id)}>{n.title}</a> <span>{n.degree}</span></li>
			{/each}
		</ol>
	</details>
</div>

<style>
	.graph {
		position: relative;
		height: 100dvh;
		overflow: hidden;
		background:
			radial-gradient(circle at 50% 45%, var(--accent-softer) 0, transparent 60%), var(--bg);
	}
	canvas {
		display: block;
		touch-action: none;
		cursor: grab;
	}
	canvas:active {
		cursor: grabbing;
	}
	.panel {
		position: absolute;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: color-mix(in oklab, var(--surface) 88%, transparent);
		box-shadow: var(--shadow-sm);
		backdrop-filter: blur(10px);
	}
	.controls {
		top: 1rem;
		left: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		width: min(17rem, calc(100% - 2rem));
		padding: 0.9rem 1rem;
		font-size: 0.8rem;
	}
	.title-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	h1 {
		margin: 0;
		font-family: var(--font-read);
		font-size: 1.35rem;
		font-weight: 600;
	}
	.stats {
		color: var(--text-muted);
		font-size: 0.72rem;
	}
	.seg {
		display: flex;
		padding: 2px;
		border-radius: 9px;
		background: var(--surface-2);
	}
	.seg button {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		padding: 0.3rem 0.4rem;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--text-muted);
		font-size: 0.74rem;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.seg button[aria-checked='true'] {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	.depth {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-muted);
	}
	.depth input {
		flex: 1;
		accent-color: var(--accent);
	}
	.find {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		height: 2rem;
		padding: 0 0.6rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text-muted);
	}
	.find input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		color: var(--text);
		outline: none;
	}
	.toggles {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.8rem;
		color: var(--text-2);
	}
	.toggles label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.toggles input {
		accent-color: var(--accent);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.7rem;
		margin: 0;
		padding: 0;
		color: var(--text-muted);
		list-style: none;
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.sw {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
	}
	.controls .btn {
		align-self: flex-start;
	}
	.tip {
		right: 1rem;
		top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		max-width: 20rem;
		padding: 0.6rem 0.8rem;
		font-size: 0.8rem;
		pointer-events: none;
	}
	.tip strong {
		font-family: var(--font-read);
		font-size: 1rem;
	}
	.tip span {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.7rem;
	}
	.list {
		right: 1rem;
		bottom: 1rem;
		max-width: 18rem;
		max-height: 50vh;
		overflow: auto;
		padding: 0.5rem 0.8rem;
		font-size: 0.8rem;
	}
	.list summary {
		color: var(--text-muted);
		cursor: pointer;
	}
	.list ol {
		margin: 0.4rem 0 0;
		padding-left: 1.2rem;
	}
	.list li span {
		color: var(--text-faint);
		font-size: 0.7rem;
	}
	.list a {
		color: var(--text);
	}
	.options {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.options[hidden] {
		display: none;
	}
	.expand {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		margin-left: 0.25rem;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text-muted);
	}
	.chev {
		display: grid;
		transform: rotate(180deg);
		transition: transform 0.18s var(--ease);
	}
	.chev.up {
		transform: none;
	}
	.info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--border);
	}
	.info-text {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
	}
	.info-text strong {
		overflow: hidden;
		font-family: var(--font-read);
		font-size: 1.05rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.info-text span {
		overflow: hidden;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.7rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.in-list summary {
		color: var(--text-muted);
		cursor: pointer;
	}
	.in-list ol {
		margin: 0.4rem 0 0;
		padding-left: 1.2rem;
	}
	.in-list a {
		color: var(--text);
	}
	.list[hidden] {
		display: none;
	}
	/* Phones: a footer bar that expands into a sheet. */
	.controls.narrow {
		/* Pinned above the phone navigation bar. */
		position: fixed;
		top: auto;
		right: 0.75rem;
		bottom: calc(5rem + env(safe-area-inset-bottom));
		left: 0.75rem;
		z-index: 5;
		width: auto;
		max-height: 58dvh;
		overflow-y: auto;
		gap: 0.6rem;
		padding: 0.55rem 0.6rem 0.55rem 1rem;
		overscroll-behavior: contain;
	}
	.controls.narrow .title-row {
		align-items: center;
	}
	.controls.narrow h1 {
		font-size: 1.15rem;
	}
	.controls.narrow .stats {
		margin-left: auto;
	}
	@media (max-width: 960px) {
		.graph {
			height: calc(100dvh - 4.5rem);
		}
		.list {
			bottom: 0.75rem;
		}
	}
</style>
