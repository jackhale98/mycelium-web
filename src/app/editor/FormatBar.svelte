<script lang="ts">
	// Formatting buttons for the org editor. On phones the bar floats just
	// above the on-screen keyboard while the editor has focus (positioned from
	// the visual viewport, since iOS keeps fixed elements behind the
	// keyboard); on wider screens it sits at the bottom of the editor.
	// Buttons never take focus, so the keyboard stays up and the cursor put.
	import Icon from '../components/Icon.svelte';
	import type { IconName } from '../components/Icon.svelte';

	export type FormatAction =
		| 'heading'
		| 'todo'
		| 'bold'
		| 'italic'
		| 'underline'
		| 'strike'
		| 'code'
		| 'bullet'
		| 'number'
		| 'checkbox'
		| 'indent'
		| 'outdent'
		| 'link'
		| 'table'
		| 'math'
		| 'undo'
		| 'redo'
		| 'done';

	let {
		focused,
		level,
		onaction,
	}: {
		/** The editor has focus (the bar shows on phones only then). */
		focused: boolean;
		/** Heading level of the cursor's line (0 for body text). */
		level: number;
		onaction: (action: FormatAction) => void;
	} = $props();

	// How far the keyboard (or anything else) covers the bottom of the layout
	// viewport, re-measured every frame while typing on a phone and written
	// straight to the element. iOS scrolls the page on its own thread and
	// tells scripts afterwards, so a bar that follows a scrolling page always
	// trails it and judders: instead it fades out while the page moves and
	// comes back, in place, once it settles. Keyboard changes (a new height)
	// move it at once.
	let bar: HTMLDivElement | undefined = $state();
	$effect(() => {
		const vv = window.visualViewport;
		const el = bar;
		if (!vv || !el || !focused || !window.matchMedia('(max-width: 960px)').matches) return;
		let last = -1;
		let height = vv.height;
		let top = vv.offsetTop;
		let scrollY = window.scrollY;
		let settle: ReturnType<typeof setTimeout> | null = null;
		let frame = 0;
		const moving = () => {
			el.classList.add('moving');
			if (settle) clearTimeout(settle);
			settle = setTimeout(() => el.classList.remove('moving'), 160);
		};
		const place = () => {
			const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
			const scrolled = vv.offsetTop !== top || window.scrollY !== scrollY;
			if (scrolled && vv.height === height) moving();
			height = vv.height;
			top = vv.offsetTop;
			scrollY = window.scrollY;
			if (kb !== last) el.style.setProperty('--kb', `${(last = kb)}px`);
			frame = requestAnimationFrame(place);
		};
		place();
		window.addEventListener('scroll', moving, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			if (settle) clearTimeout(settle);
			window.removeEventListener('scroll', moving);
			el.classList.remove('moving');
		};
	});

	type Button = {
		action: FormatAction;
		label: string;
		icon?: IconName;
		text?: string;
		cls?: string;
	};
	const groups: Button[][] = $derived([
		[
			{
				action: 'heading',
				label: level ? `Heading level ${level} (tap for next level)` : 'Make a heading',
				text: level ? `H${level}` : 'H',
				cls: 'h',
			},
			{ action: 'todo', label: 'Cycle TODO state', text: 'TODO', cls: 'todo' },
		],
		[
			{ action: 'bold', label: 'Bold', text: 'B', cls: 'b' },
			{ action: 'italic', label: 'Italic', text: 'I', cls: 'i' },
			{ action: 'underline', label: 'Underline', text: 'U', cls: 'u' },
			{ action: 'strike', label: 'Strikethrough', text: 'S', cls: 's' },
			{ action: 'code', label: 'Code', text: '~', cls: 'c' },
		],
		[
			{ action: 'bullet', label: 'Bulleted list', icon: 'list' },
			{ action: 'number', label: 'Numbered list', icon: 'listOrdered' },
			{ action: 'checkbox', label: 'Checkbox (tap again to tick)', icon: 'checkSquare' },
			{ action: 'outdent', label: 'Outdent or promote', icon: 'outdent' },
			{ action: 'indent', label: 'Indent or demote', icon: 'indent' },
		],
		[
			{ action: 'table', label: 'Table', icon: 'table' },
			{ action: 'math', label: 'Maths (LaTeX)', icon: 'sigma' },
			{ action: 'link', label: 'Link to a note', icon: 'link' },
			{ action: 'undo', label: 'Undo', icon: 'undo' },
			{ action: 'redo', label: 'Redo', icon: 'redo' },
		],
	]);
</script>

<div
	class="format-bar"
	class:focused
	bind:this={bar}
	role="toolbar"
	aria-label="Formatting"
	tabindex="-1"
>
	<div class="scroll">
		{#each groups as group, g (g)}
			<div class="group">
				{#each group as b (b.action)}
					<button
						type="button"
						class={b.cls}
						class:on={b.action === 'heading' && level > 0}
						aria-label={b.label}
						title={b.label}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => onaction(b.action)}
					>
						{#if b.icon}<Icon name={b.icon} size={18} />{:else}{b.text}{/if}
					</button>
				{/each}
			</div>
		{/each}
	</div>
	<button
		type="button"
		class="done"
		aria-label="Hide keyboard"
		title="Hide keyboard"
		onmousedown={(e) => e.preventDefault()}
		onclick={() => onaction('done')}><Icon name="keyboardDown" size={18} /></button
	>
</div>

<style>
	.format-bar {
		position: sticky;
		bottom: 0.75rem;
		z-index: 6;
		display: flex;
		align-items: center;
		max-width: 100%;
		margin: 0 auto;
		padding: 0.25rem;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: color-mix(in oklab, var(--surface) 94%, transparent);
		box-shadow: var(--shadow-md);
		backdrop-filter: blur(14px) saturate(1.3);
		width: fit-content;
	}
	.done {
		display: none;
	}
	.scroll {
		display: flex;
		align-items: center;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
		overscroll-behavior-x: contain;
	}
	.scroll::-webkit-scrollbar {
		display: none;
	}
	.group {
		display: flex;
		flex: none;
		gap: 0.1rem;
	}
	.group + .group {
		margin-left: 0.3rem;
		padding-left: 0.3rem;
		border-left: 1px solid var(--border);
	}
	button {
		display: grid;
		place-items: center;
		flex: none;
		min-width: 2.5rem;
		height: 2.5rem;
		padding: 0 0.4rem;
		border: 0;
		border-radius: 9px;
		background: none;
		color: var(--text-2);
		font-family: var(--font-read);
		font-size: 1.05rem;
		line-height: 1;
		touch-action: manipulation;
		-webkit-user-select: none;
		user-select: none;
	}
	@media (min-width: 961px) {
		button {
			min-width: 2.2rem;
			height: 2.2rem;
		}
	}
	button:hover,
	button:active {
		background: var(--surface-2);
		color: var(--text);
	}
	.on {
		color: var(--accent);
	}
	.h {
		font-family: var(--font-ui);
		font-weight: 750;
	}
	.todo {
		color: var(--todo);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 750;
		letter-spacing: 0.04em;
	}
	.b {
		font-weight: 800;
	}
	.i {
		font-style: italic;
	}
	.u {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.s {
		text-decoration: line-through;
	}
	.c {
		font-family: var(--font-mono);
		font-variant-ligatures: none;
	}
	/* Phones and tablets: float above the keyboard, only while typing. */
	@media (max-width: 960px) {
		.format-bar {
			position: fixed;
			inset: auto 0 0 0;
			z-index: 45;
			display: none;
			width: auto;
			padding: 0.25rem 0.25rem 0.25rem 0.4rem;
			border-width: 1px 0 0;
			border-radius: 0;
			box-shadow: none;
			/* Solid: a backdrop blur on a moving layer blurs its text on iOS. */
			background: var(--surface);
			backdrop-filter: none;
			transform: translateY(calc(-1 * var(--kb, 0px)));
			transition: opacity 0.15s var(--ease);
		}
		.format-bar.focused {
			display: flex;
		}
		.format-bar:global(.moving) {
			opacity: 0;
			pointer-events: none;
			transition: opacity 0.08s linear;
		}
		/* With the keyboard down, keep clear of the home indicator. */
		.format-bar.focused {
			padding-bottom: max(0.25rem, calc(env(safe-area-inset-bottom) - var(--kb, 0px)));
		}
		.scroll {
			flex: 1;
		}
		.done {
			display: grid;
			margin-left: 0.25rem;
			padding-left: 0.3rem;
			border-left: 1px solid var(--border);
			border-radius: 0;
		}
	}
</style>
