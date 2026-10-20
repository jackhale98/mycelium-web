<script lang="ts">
	import {
		describeSettings,
		parseSettings,
		type SettingsFile,
		type SettingsSection,
	} from '../settings-file';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	let input: HTMLInputElement | undefined = $state();
	let pending = $state<{ name: string; file: SettingsFile } | null>(null);
	let chosen = $state<Set<SettingsSection>>(new Set());
	let error = $state<string | null>(null);
	let message = $state<string | null>(null);

	const sections = $derived(pending ? describeSettings(pending.file) : []);

	async function download() {
		const text = await app.settingsFile();
		const name = (app.activeVault?.name ?? 'vault').replace(/[^\w.-]+/g, '-');
		const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = `mycelium-settings-${name}.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function pick(e: Event & { currentTarget: HTMLInputElement }) {
		error = null;
		message = null;
		const f = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		if (!f) return;
		try {
			const file = parseSettings(await f.text());
			pending = { name: f.name, file };
			chosen = new Set(describeSettings(file).map((s) => s.section));
		} catch (err) {
			pending = null;
			error = err instanceof Error ? err.message : String(err);
		}
	}

	function toggle(section: SettingsSection, on: boolean) {
		const next = new Set(chosen);
		if (on) next.add(section);
		else next.delete(section);
		chosen = next;
	}

	async function apply() {
		if (!pending || !chosen.size) return;
		error = null;
		try {
			await app.importSettings(pending.file, chosen);
		} catch (err) {
			error = `Couldn't import: ${err instanceof Error ? err.message : String(err)}`;
			return;
		}
		message = `Imported ${chosen.size} ${chosen.size === 1 ? 'section' : 'sections'} from ${pending.name}.`;
		pending = null;
	}
</script>

<p class="hint">
	Move your TODO keywords, capture templates, agenda views, vault layout and appearance between
	vaults and devices. Tokens, the repository address and your commit name are never included.
</p>
<div class="row">
	<button type="button" class="btn small" onclick={download}
		><Icon name="arrowDown" size={14} />Export settings</button
	>
	<button type="button" class="btn small" onclick={() => input?.click()}
		><Icon name="arrowUp" size={14} />Import settings…</button
	>
	<input
		bind:this={input}
		class="sr-only"
		type="file"
		accept="application/json,.json"
		aria-label="Settings file to import"
		tabindex="-1"
		onchange={pick}
	/>
</div>

{#if error}
	<p class="notice error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></p>
{/if}

{#if pending}
	<fieldset class="import">
		<legend>Import from {pending.name}</legend>
		{#each sections as s (s.section)}
			<label class="check"
				><input
					type="checkbox"
					checked={chosen.has(s.section)}
					onchange={(e) => toggle(s.section, e.currentTarget.checked)}
				/>
				<span>{s.label}</span></label
			>
		{/each}
		<p class="hint">Chosen sections replace this vault's current ones.</p>
		<div class="row">
			<button type="button" class="btn small" onclick={() => (pending = null)}>Cancel</button>
			<button type="button" class="btn small primary" disabled={!chosen.size} onclick={apply}
				>Import</button
			>
		</div>
	</fieldset>
{/if}
<p class="saved" role="status" aria-live="polite">{message ?? ''}</p>

<style>
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.82rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.import {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
		margin: 0;
		padding: 0.8rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	legend {
		padding: 0 0.3rem;
		font-size: 0.85rem;
		font-weight: 650;
		overflow-wrap: anywhere;
	}
	.check {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.86rem;
		overflow-wrap: anywhere;
	}
	.check input {
		accent-color: var(--accent);
	}
	.saved {
		min-height: 1rem;
		margin: 0;
		color: var(--accent);
		font-size: 0.84rem;
		font-weight: 600;
	}
</style>
