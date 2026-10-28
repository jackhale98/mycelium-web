<script lang="ts">
	// What counts as a stuck project in this vault: org's org-stuck-projects,
	// all four parts. Shared by the agenda's Stuck view and Settings → Tasks.
	import { DEFAULT_STUCK, stuckSettingsOf } from '../agenda';
	import { app } from '../state.svelte';

	let { idPrefix = 'stuck' }: { idPrefix?: string } = $props();

	const current = $derived(stuckSettingsOf(app.activeVault?.stuckProjects));
	let match = $state('');
	let keywords = $state('');
	let tags = $state('');
	let regexp = $state('');
	let saved = $state<string | null>(null);
	$effect(() => {
		match = current.match;
		keywords = current.keywords.join(' ');
		tags = current.tags.join(' ');
		regexp = current.regexp;
	});

	const words = (s: string) => s.split(/[\s,:]+/).filter(Boolean);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		await app.updateVault({
			stuckProjects: {
				match: match.trim() || DEFAULT_STUCK.match,
				keywords: words(keywords),
				tags: words(tags),
				regexp: regexp.trim(),
			},
		});
		saved = 'Saved for this vault.';
	}

	async function reset() {
		await app.updateVault({ stuckProjects: { ...DEFAULT_STUCK } });
		saved = 'Back to org’s default.';
	}
</script>

<form class="stuck" onsubmit={save}>
	<div class="field">
		<label for={`${idPrefix}-match`}>Projects are headings matching</label>
		<input
			id={`${idPrefix}-match`}
			class="input mono"
			bind:value={match}
			spellcheck="false"
			autocomplete="off"
		/>
		<span class="hint"
			>An org match string. org’s default <code>+LEVEL=2/-DONE</code> is every second-level heading
			not done; <code>+project/-DONE</code> is every heading tagged :project:.</span
		>
	</div>
	<div class="field">
		<label for={`${idPrefix}-kw`}>Not stuck when something under it is in state</label>
		<input
			id={`${idPrefix}-kw`}
			class="input mono"
			bind:value={keywords}
			spellcheck="false"
			autocomplete="off"
		/>
		<span class="hint">TODO keywords, separated by spaces (org: TODO NEXT NEXTACTION).</span>
	</div>
	<div class="field">
		<label for={`${idPrefix}-tags`}>…or a heading under it has a tag</label>
		<input
			id={`${idPrefix}-tags`}
			class="input mono"
			bind:value={tags}
			spellcheck="false"
			autocomplete="off"
			placeholder="e.g. someday"
		/>
		<span class="hint">Tags, separated by spaces. Empty: tags don’t matter.</span>
	</div>
	<div class="field">
		<label for={`${idPrefix}-re`}>…or its text matches</label>
		<input
			id={`${idPrefix}-re`}
			class="input mono"
			bind:value={regexp}
			spellcheck="false"
			autocomplete="off"
			placeholder="e.g. \bWAITING FOR\b"
		/>
		<span class="hint">A regular expression. Empty: text doesn’t matter.</span>
	</div>
	<div class="actions">
		<button class="btn small primary">Save for this vault</button>
		<button type="button" class="btn small" onclick={reset}>Use org’s default</button>
		{#if saved}<span class="saved" role="status">{saved}</span>{/if}
	</div>
</form>

<style>
	.stuck {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		max-width: 34rem;
	}
	.mono {
		font-family: var(--font-mono);
		font-size: 0.86rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.saved {
		color: var(--text-muted);
		font-size: 0.82rem;
	}
</style>
