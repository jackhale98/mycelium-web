<script lang="ts">
	// The tile-less mark: green threads on light, gold on dark (the tiled icon is
	// for favicons and home screens).
	let { size = 28 }: { size?: number } = $props();
	const base = import.meta.env.BASE_URL.replace(/\/$/, '');
	// The mark is taller than wide (328 × 372).
	const width = $derived(Math.round((size * 328) / 372));
</script>

<span class="logo" style:height="{size}px" aria-hidden="true">
	<img class="only-light" src="{base}/mycelium-mark-light.svg" {width} height={size} alt="" />
	<img class="only-dark" src="{base}/mycelium-mark-dark.svg" {width} height={size} alt="" />
</span>

<style>
	.logo {
		display: inline-flex;
		flex: none;
	}
</style>
