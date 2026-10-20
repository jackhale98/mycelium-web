<script lang="ts">
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	const busy = $derived(app.sync.kind === 'busy');
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(t);
	});

	const lastSync = $derived(app.activeVault?.lastSync ?? null);
	function ago(t: number) {
		const s = Math.max(0, Math.round((now - t) / 1000));
		if (s < 60) return 'just now';
		const m = Math.round(s / 60);
		if (m < 60) return `${m} min ago`;
		const h = Math.round(m / 60);
		return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
	}

	const status = $derived.by(() => {
		if (app.demo)
			return app.unsynced
				? `${app.unsynced} ${app.unsynced === 1 ? 'edit' : 'edits'} in this tab`
				: 'Demo vault';
		if (app.sync.kind === 'busy') return `${app.sync.phase}…`;
		if (app.unsynced)
			return `${app.unsynced} unsynced ${app.unsynced === 1 ? 'change' : 'changes'}`;
		return lastSync ? `Synced ${ago(lastSync)}` : 'Not synced yet';
	});
</script>

<div class="sync">
	<span class="dot" class:pending={app.unsynced > 0} class:busy aria-hidden="true"></span>
	<span class="status" role="status" aria-live="polite">{status}</span>
	{#if !app.demo}
		<button
			type="button"
			class="btn small sync-btn"
			onclick={() => app.syncNow()}
			disabled={busy}
			aria-label="Sync with remote"
		>
			<span class="spin" class:on={busy}><Icon name="sync" size={15} /></span>
			Sync
		</button>
	{/if}
</div>

<style>
	.sync {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		flex: 1;
	}
	.dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
	}
	.dot.pending {
		background: var(--todo);
		box-shadow: 0 0 0 3px var(--todo-soft);
	}
	.dot.busy {
		background: var(--next);
		box-shadow: 0 0 0 3px var(--next-soft);
	}
	.status {
		overflow: hidden;
		color: var(--text-muted);
		font-size: 0.75rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sync-btn {
		margin-left: auto;
		height: 1.9rem;
		padding: 0 0.6rem;
		font-size: 0.76rem;
	}
	.spin {
		display: grid;
	}
	.spin.on {
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
