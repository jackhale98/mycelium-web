<script lang="ts">
	let { error }: { error: unknown } = $props();
</script>

<div class="load-error" role="alert">
	<h1>This page didn't load</h1>
	<p>
		Mycelium was probably updated while it was open. Reloading fetches the new version; your notes
		and unsaved edits stay in this browser.
	</p>
	<button type="button" class="btn primary" onclick={() => location.reload()}>Reload</button>
	<p class="detail">{error instanceof Error ? error.message : String(error)}</p>
</div>

<style>
	.load-error {
		max-width: 36rem;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}
	h1 {
		margin: 0 0 0.75rem;
		font-family: var(--font-read);
		font-size: 1.8rem;
	}
	p {
		color: var(--text-muted);
	}
	.detail {
		margin-top: 1.5rem;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		overflow-wrap: anywhere;
	}
</style>
