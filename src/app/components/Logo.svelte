<script lang="ts">
	let { size = 28 }: { size?: number } = $props();
</script>

<svg class="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
	<rect class="bg" width="64" height="64" rx="16" />
	<path
		class="strands"
		d="M32 50V30M32 30c0-8 6-12 12-14M32 30c0-8-6-12-12-14M32 38c4-3 9-3 13 0M32 38c-4-3-9-3-13 0"
	/>
	<g class="spores">
		<circle cx="44" cy="16" r="3.6" /><circle cx="20" cy="16" r="3.6" /><circle
			cx="45"
			cy="38"
			r="3"
		/><circle cx="19" cy="38" r="3" /><circle cx="32" cy="50" r="3.6" />
	</g>
</svg>

<style>
	.logo {
		flex: none;
	}
	.bg {
		fill: var(--accent);
	}
	.strands {
		fill: none;
		stroke: var(--on-accent);
		stroke-width: 3.2;
		stroke-linecap: round;
	}
	.spores {
		fill: var(--on-accent);
	}
</style>
