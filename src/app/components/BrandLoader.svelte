<script lang="ts">
	// The Mycelium loading animation: roots spread from the stem base, light
	// climbs the stem, the cap's notes link up, then nutrients keep flowing.
	// Rendered statically before the app boots (app.astro) and inline while a
	// vault clones. Honours prefers-reduced-motion.
	import data from './brand-data.json';

	let {
		mode = 'inline',
		message = null,
		label = 'Loading Mycelium',
	}: { mode?: 'screen' | 'inline'; message?: string | null; label?: string } = $props();

	const uid = $props.id();
	let line = $state(data.lines[0] ?? '');

	$effect(() => {
		if (message) return;
		const lines = [...data.lines].sort(() => Math.random() - 0.5);
		let k = 0;
		line = lines[0] ?? '';
		const timer = setInterval(() => (line = lines[++k % lines.length] ?? ''), 2600);
		return () => clearInterval(timer);
	});
</script>

<div
	class="myc {mode}"
	role="status"
	aria-live="polite"
	aria-label={label}
	id={mode === 'screen' ? 'myc-loader' : undefined}
>
	<div class="stage">
		<div class="aura" aria-hidden="true"></div>
		<svg class="mark" viewBox="92 84 328 372" aria-hidden="true">
			<defs>
				<linearGradient
					id="{uid}-w"
					gradientUnits="userSpaceOnUse"
					x1="120"
					y1="440"
					x2="390"
					y2="100"
				>
					<stop offset="0" stop-color="#C4882A" /><stop offset="0.45" stop-color="#E0B050" /><stop
						offset="1"
						stop-color="#F4D58D"
					/>
				</linearGradient>
				<filter id="{uid}-glow" x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation="3" result="b" /><feMerge
						><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge
					>
				</filter>
			</defs>
			<g fill="none" stroke="url(#{uid}-w)" stroke-linecap="round">
				{#each data.edges as e, i (i)}
					<path
						class="e"
						pathLength="1"
						d={e.d}
						stroke-width={e.w}
						style:--o={e.o}
						style:--d={e.delay}
						style:--t={e.t}
					/>
				{/each}
				<path
					class="stem"
					pathLength="1"
					d={data.stem}
					stroke-width="8"
					filter="url(#{uid}-glow)"
				/>
			</g>
			<g fill="none" stroke-linecap="round">
				<path class="spark" pathLength="1" d={data.stem} />
				{#each data.pulses as p, i (i)}
					<path class="p" pathLength="1" d={p.d} style:--d={p.delay} />
				{/each}
			</g>
			<circle class="flare" cx="256" cy="240" r="9" />
			<g filter="url(#{uid}-glow)">
				{#each data.nodes as n, i (i)}
					<circle
						class="n"
						class:hub={n.hub}
						cx={n.cx}
						cy={n.cy}
						r={n.r}
						fill={n.fill}
						style:--d={n.delay}
						style:--tw={n.tw}
						style:--twd={n.twd}
					/>
				{/each}
			</g>
		</svg>
	</div>
	{#if mode === 'screen'}<div class="word">mycelium</div>{/if}
	<div class="msg"><span>{message ?? line}</span></div>
</div>

<style>
	.myc {
		--myc-bg: #0f1a0e;
		--myc-bg-2: #1c2a1a;
		--myc-fg: #f4e7c6;
		--myc-muted: #b3aa8a;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		color: var(--myc-fg);
		font-family: var(--font-ui);
	}
	.screen {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: radial-gradient(120% 90% at 50% 38%, var(--myc-bg-2), var(--myc-bg) 70%);
		transition:
			opacity 0.7s ease,
			transform 0.7s cubic-bezier(0.2, 0.8, 0.2, 1),
			filter 0.7s ease;
	}
	:global(.myc-done).screen {
		opacity: 0;
		transform: scale(1.05);
		filter: blur(6px);
		pointer-events: none;
	}
	.inline {
		padding: 1.5rem 2rem 1.25rem;
		border-radius: 22px;
		background: radial-gradient(120% 90% at 50% 38%, var(--myc-bg-2), var(--myc-bg) 75%);
		box-shadow: var(--shadow-lg);
	}
	.stage {
		position: relative;
		aspect-ratio: 328 / 372;
	}
	.screen .stage {
		width: min(220px, 52vw);
	}
	.inline .stage {
		width: 132px;
	}
	.mark {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.aura {
		position: absolute;
		inset: -30%;
		pointer-events: none;
		opacity: 0;
		background: radial-gradient(
			closest-side at 50% 36%,
			rgba(244, 213, 141, 0.16),
			transparent 72%
		);
		animation:
			myc-fade 1.2s 1.28s ease forwards,
			myc-aura 5s 2.66s ease-in-out infinite;
	}
	.e {
		stroke-dasharray: 1 1;
		stroke-dashoffset: 1;
		opacity: var(--o);
		animation: myc-draw var(--t) var(--d) cubic-bezier(0.35, 0.6, 0.3, 1) forwards;
	}
	.stem {
		stroke-dasharray: 1 1;
		stroke-dashoffset: 1;
		animation: myc-draw 0.5s 0.76s cubic-bezier(0.5, 0, 0.3, 1) forwards;
	}
	.n {
		transform-box: fill-box;
		transform-origin: center;
		transform: scale(0);
		animation:
			myc-pop 0.5s var(--d) cubic-bezier(0.3, 1.7, 0.5, 1) forwards,
			myc-twinkle var(--twd) var(--tw) ease-in-out infinite;
	}
	.n.hub {
		animation:
			myc-pop 0.6s var(--d) cubic-bezier(0.3, 1.9, 0.5, 1) forwards,
			myc-twinkle var(--twd) var(--tw) ease-in-out infinite;
	}
	.spark {
		stroke: #fff6dc;
		stroke-width: 7;
		stroke-dasharray: 0.16 1.3;
		stroke-dashoffset: 0.16;
		opacity: 0;
		filter: drop-shadow(0 0 6px #f4d58d);
		animation: myc-spark 0.5s 0.76s cubic-bezier(0.5, 0, 0.3, 1) forwards;
	}
	.flare {
		fill: none;
		stroke: #f4d58d;
		stroke-width: 3;
		opacity: 0;
		transform-box: fill-box;
		transform-origin: center;
		animation: myc-flare 0.9s 1.22s ease-out forwards;
	}
	.p {
		stroke: #fff2cc;
		stroke-width: 5;
		stroke-dasharray: 0.05 1.2;
		stroke-dashoffset: 0.05;
		opacity: 0;
		filter: drop-shadow(0 0 5px #f4d58d);
		animation: myc-flow 3.3s var(--d) cubic-bezier(0.45, 0.05, 0.4, 1) infinite;
	}
	.word {
		margin-top: 10px;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: 0.04em;
		opacity: 0;
		transform: translateY(6px);
		animation: myc-rise 0.8s 1.92s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
	}
	.msg {
		height: 20px;
		overflow: hidden;
		color: var(--myc-muted);
		font-size: 13.5px;
		opacity: 0;
		animation: myc-fade 0.6s 2.2s ease forwards;
	}
	.inline .msg {
		margin-top: 0.4rem;
		animation-delay: 0.3s;
	}
	.msg span {
		display: block;
		animation: myc-line 2.6s ease infinite;
	}
	@keyframes myc-draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes myc-fade {
		to {
			opacity: 1;
		}
	}
	@keyframes myc-rise {
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes myc-pop {
		0% {
			transform: scale(0);
		}
		100% {
			transform: scale(1);
		}
	}
	@keyframes myc-twinkle {
		0%,
		100% {
			transform: scale(1);
			opacity: 1;
		}
		50% {
			transform: scale(0.82);
			opacity: 0.6;
		}
	}
	@keyframes myc-aura {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.65;
			transform: scale(1.05);
		}
	}
	@keyframes myc-spark {
		0% {
			opacity: 1;
			stroke-dashoffset: 0.16;
		}
		90% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			stroke-dashoffset: -1;
		}
	}
	@keyframes myc-flare {
		0% {
			opacity: 0.9;
			transform: scale(1);
		}
		100% {
			opacity: 0;
			transform: scale(5);
		}
	}
	@keyframes myc-flow {
		0% {
			stroke-dashoffset: 0.05;
			opacity: 1;
		}
		85% {
			opacity: 1;
		}
		100% {
			stroke-dashoffset: -1.05;
			opacity: 0;
		}
	}
	@keyframes myc-line {
		0% {
			opacity: 0;
			transform: translateY(8px);
		}
		14%,
		86% {
			opacity: 1;
			transform: none;
		}
		100% {
			opacity: 0;
			transform: translateY(-8px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.myc * {
			animation: none !important;
		}
		.e,
		.stem {
			stroke-dashoffset: 0;
		}
		.n {
			transform: none;
		}
		.aura,
		.word,
		.msg {
			opacity: 1;
			transform: none;
		}
		.p,
		.spark,
		.flare {
			display: none;
		}
	}
</style>
