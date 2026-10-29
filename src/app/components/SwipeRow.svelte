<script lang="ts" module>
	export interface SwipeAction {
		label: string;
		icon: 'check' | 'undo' | 'calendar' | 'clock' | 'settings';
		run: () => void;
		tone?: 'accent' | 'neutral' | 'warn';
	}

	/** Only one row is open at a time: opening another closes this one. */
	let closeOpen: (() => void) | null = null;
</script>

<script lang="ts">
	// A row that answers sideways swipes on touch screens (a mouse is left
	// alone; the row's own buttons do the same things):
	// - left to right: the main action (a task: Done, or Reopen), committed
	//   when let go past a third of the way, with its colour and name showing
	//   underneath as it's dragged;
	// - right to left: uncovers a few action buttons, which stay until one is
	//   tapped, the row is tapped or swiped back, or another row opens.
	// A swipe starting by the screen's left edge is the browser's (back), and
	// one that's more up-and-down than sideways scrolls the page as usual.
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		children,
		main = null,
		actions = [],
	}: {
		children: Snippet;
		/** Swiping left to right. */
		main?: SwipeAction | null;
		/** Uncovered by swiping right to left. */
		actions?: SwipeAction[];
	} = $props();

	const EDGE = 24;
	const BUTTON_W = 76;
	const tray = $derived(actions.length * BUTTON_W);

	let root = $state<HTMLElement>();
	/** The row's offset: positive while dragged right, `-tray` when open. */
	let x = $state(0);
	let animate = $state(false);
	let open = $state(false);
	let committing = $state(false);

	const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

	function settle(to: number) {
		animate = !reduced();
		x = to;
	}
	function close() {
		open = false;
		settle(0);
		if (closeOpen === close) closeOpen = null;
	}
	function openTray() {
		if (closeOpen && closeOpen !== close) closeOpen();
		open = true;
		closeOpen = close;
		settle(-tray);
	}
	function commit(action: SwipeAction) {
		const width = root?.offsetWidth ?? 360;
		committing = true;
		settle(width);
		setTimeout(
			() => {
				action.run();
				committing = false;
				animate = false;
				x = 0;
			},
			reduced() ? 0 : 180,
		);
	}
	function run(action: SwipeAction) {
		close();
		action.run();
	}

	/** Past this (dragging right), letting go runs the main action. */
	const threshold = () => Math.min(160, (root?.offsetWidth ?? 360) * 0.35);
	const armed = $derived(main !== null && x >= threshold());

	$effect(() => {
		const el = root;
		if (!el) return;
		let start: { x: number; y: number; base: number } | null = null;
		let axis: 'x' | 'y' | null = null;
		let swallow = false;

		const touchstart = (e: TouchEvent) => {
			swallow = false;
			axis = null;
			const t = e.touches[0];
			if (e.touches.length !== 1 || !t || committing) {
				start = null;
				return;
			}
			// The tray's own buttons take their taps.
			if ((e.target as Element).closest('.tray')) {
				start = null;
				return;
			}
			if (t.clientX < EDGE) {
				start = null;
				return;
			}
			start = { x: t.clientX, y: t.clientY, base: open ? -tray : 0 };
		};
		const touchmove = (e: TouchEvent) => {
			if (!start) return;
			const t = e.touches[0]!;
			const dx = t.clientX - start.x;
			const dy = t.clientY - start.y;
			if (!axis) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
				axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
				if (axis === 'y') {
					start = null;
					return;
				}
				if (closeOpen && closeOpen !== close) closeOpen();
			}
			e.preventDefault();
			swallow = true;
			animate = false;
			const max = main ? Infinity : 0;
			const min = actions.length ? -tray - 32 : 0;
			x = Math.max(min, Math.min(max, start.base + dx));
		};
		const touchend = () => {
			if (!start || axis !== 'x') {
				start = null;
				return;
			}
			const base = start.base;
			start = null;
			if (main && x >= threshold()) commit(main);
			else if (base === 0 && x < -48 && actions.length) openTray();
			else if (base !== 0 && x < -tray / 2) openTray();
			else close();
		};
		// The click that ends a swipe isn't a tap on the row; neither is a tap
		// that closes an open tray.
		const click = (e: MouseEvent) => {
			if ((e.target as Element).closest('.tray')) return;
			if (swallow || open) {
				e.preventDefault();
				e.stopPropagation();
				swallow = false;
				if (open) close();
			}
		};
		// A touch anywhere else closes an open tray.
		const outside = (e: TouchEvent) => {
			if (open && !el.contains(e.target as Node)) close();
		};
		el.addEventListener('touchstart', touchstart, { passive: true });
		el.addEventListener('touchmove', touchmove, { passive: false });
		el.addEventListener('touchend', touchend);
		el.addEventListener('touchcancel', touchend);
		el.addEventListener('click', click, true);
		document.addEventListener('touchstart', outside, { passive: true });
		return () => {
			el.removeEventListener('touchstart', touchstart);
			el.removeEventListener('touchmove', touchmove);
			el.removeEventListener('touchend', touchend);
			el.removeEventListener('touchcancel', touchend);
			el.removeEventListener('click', click, true);
			document.removeEventListener('touchstart', outside);
			if (closeOpen === close) closeOpen = null;
		};
	});
</script>

<div class="swipe" class:active={x !== 0 || open || committing} bind:this={root}>
	{#if main && x > 0}
		<div class={`under main ${main.tone ?? 'accent'}`} class:armed aria-hidden="true">
			<Icon name={main.icon} size={18} /><span>{main.label}</span>
		</div>
	{/if}
	{#if actions.length}
		<div
			class="tray"
			style:width="{tray}px"
			inert={!open}
			aria-hidden={!open}
			hidden={x >= 0 && !open}
		>
			{#each actions as a (a.label)}
				<button type="button" class={a.tone ?? 'neutral'} onclick={() => run(a)}
					><Icon name={a.icon} size={18} /><span>{a.label}</span></button
				>
			{/each}
		</div>
	{/if}
	<div class="front" class:animate style:transform={x ? `translateX(${x}px)` : undefined}>
		{@render children()}
	</div>
</div>

<style>
	.swipe {
		position: relative;
		width: 100%;
	}
	/* Clipped only while moved, so nothing that hangs outside the row is cut off at rest. */
	.swipe.active {
		overflow: hidden;
	}
	.front {
		position: relative;
		z-index: 1;
		background: var(--swipe-bg, var(--bg));
		touch-action: pan-y;
	}
	.front.animate {
		transition: transform 0.18s var(--ease);
	}
	.under {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-left: 1.25rem;
		font-family: var(--font-ui);
		font-size: 0.9rem;
		font-weight: 650;
	}
	.under.main {
		background: var(--surface-2);
		color: var(--text-muted);
		transition:
			background-color 0.15s,
			color 0.15s;
	}
	.under.main.armed.accent {
		background: var(--accent);
		color: var(--on-accent);
	}
	.under.main.armed.neutral,
	.under.main.armed.warn {
		background: var(--warn);
		color: var(--on-accent);
	}
	.tray {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		display: flex;
	}
	.tray[hidden] {
		display: none;
	}
	.tray button {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		border: 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 650;
	}
	.tray .neutral {
		background: var(--surface-3);
		color: var(--text);
	}
	.tray .accent {
		background: var(--accent);
		color: var(--on-accent);
	}
	.tray .warn {
		background: var(--warn);
		color: var(--on-accent);
	}
	@media (prefers-reduced-motion: reduce) {
		.front.animate {
			transition: none;
		}
	}
</style>
