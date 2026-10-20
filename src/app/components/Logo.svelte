<script lang="ts">
	let { size = 28 }: { size?: number } = $props();
	const src = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/mycelium-icon.svg`;
</script>

<img class="logo" {src} width={size} height={size} alt="" />

<style>
	.logo {
		flex: none;
		border-radius: 22%;
	}
</style>
