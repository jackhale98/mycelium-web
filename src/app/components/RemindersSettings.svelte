<script lang="ts">
	// Reminders on this device: turn them on (the browser asks permission),
	// choose how far ahead and for what, the task count on the app icon, and
	// whether the sync worker should also send them while Mycelium is closed.
	import { onMount } from 'svelte';
	import { reminders, remindersAhead, showReminder } from '../reminders.svelte';
	import { app } from '../state.svelte';

	const s = $derived(reminders.settings);
	const supported = reminders.permission !== 'unsupported';
	const badgeSupported = typeof navigator !== 'undefined' && 'setAppBadge' in navigator;
	// iPhone and iPad allow notifications only for an app added to the Home Screen.
	const iosBrowser =
		typeof navigator !== 'undefined' &&
		/iPhone|iPad|iPod/.test(navigator.userAgent) &&
		!matchMedia('(display-mode: standalone)').matches;

	let pushAvailable = $state<boolean | null>(null);
	let busy = $state(false);
	onMount(() => {
		void import('../push').then((p) => p.pushAvailable()).then((ok) => (pushAvailable = ok));
	});

	const LEADS = [
		{ value: 0, label: 'At the time' },
		{ value: 5, label: '5 minutes before' },
		{ value: 10, label: '10 minutes before' },
		{ value: 15, label: '15 minutes before' },
		{ value: 30, label: '30 minutes before' },
		{ value: 60, label: '1 hour before' },
	];

	const next = $derived.by(() => {
		void app.rev;
		return s.enabled ? remindersAhead(s, 7 * 86_400_000).slice(0, 3) : [];
	});
	const when = (ms: number) =>
		new Date(ms).toLocaleString(undefined, {
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit',
		});

	async function toggle(on: boolean) {
		busy = true;
		try {
			if (on) await reminders.enable();
			else {
				if (s.push) await reminders.setPush(false);
				reminders.update({ enabled: false });
			}
		} finally {
			busy = false;
		}
	}

	async function togglePush(on: boolean) {
		busy = true;
		try {
			await reminders.setPush(on);
		} finally {
			busy = false;
		}
	}
</script>

{#if !supported}
	<p class="hint">This browser can’t show notifications.</p>
{:else}
	{#if iosBrowser}
		<p class="hint">
			On iPhone and iPad, add Mycelium to your Home Screen first (Share → Add to Home Screen), then
			turn reminders on from there.
		</p>
	{/if}
	<label class="check">
		<input
			type="checkbox"
			checked={s.enabled && reminders.permission === 'granted'}
			disabled={busy || reminders.permission === 'denied'}
			onchange={(e) => toggle(e.currentTarget.checked)}
		/>
		Remind me about scheduled items and deadlines
	</label>
	{#if reminders.permission === 'denied'}
		<p class="hint">
			Notifications are blocked for this site. Allow them in your browser’s site settings, then come
			back here.
		</p>
	{/if}

	{#if s.enabled && reminders.permission === 'granted'}
		<div class="field">
			<label for="r-lead">How early</label>
			<select
				id="r-lead"
				class="input"
				value={s.lead}
				onchange={(e) => reminders.update({ lead: Number(e.currentTarget.value) })}
			>
				{#each LEADS as l (l.value)}<option value={l.value}>{l.label}</option>{/each}
			</select>
		</div>
		<label class="check">
			<input
				type="checkbox"
				checked={s.scheduled}
				onchange={(e) => reminders.update({ scheduled: e.currentTarget.checked })}
			/>
			SCHEDULED times
		</label>
		<label class="check">
			<input
				type="checkbox"
				checked={s.deadline}
				onchange={(e) => reminders.update({ deadline: e.currentTarget.checked })}
			/>
			DEADLINE times
		</label>
		<div class="untimed">
			<label class="check">
				<input
					type="checkbox"
					checked={s.untimedAt !== null}
					onchange={(e) =>
						reminders.update({ untimedAt: e.currentTarget.checked ? '09:00' : null })}
				/>
				Items without a time, on their day at
			</label>
			<input
				type="time"
				class="input time"
				aria-label="Time for items without one"
				value={s.untimedAt ?? '09:00'}
				disabled={s.untimedAt === null}
				onchange={(e) =>
					e.currentTarget.value && reminders.update({ untimedAt: e.currentTarget.value })}
			/>
		</div>
		{#if badgeSupported}
			<label class="check">
				<input
					type="checkbox"
					checked={s.badge}
					onchange={(e) => reminders.update({ badge: e.currentTarget.checked })}
				/>
				Show today’s and overdue tasks as a count on the app icon
			</label>
		{/if}

		<div class="push">
			<label class="check">
				<input
					type="checkbox"
					checked={s.push}
					disabled={busy || pushAvailable === false}
					onchange={(e) => togglePush(e.currentTarget.checked)}
				/>
				Also when Mycelium is closed
			</label>
			<p class="hint">
				{#if pushAvailable === false && !s.push}
					Not available here: it needs the installed or published app, and a sync server with
					reminders set up.
				{:else}
					This device sends the sync server the next week’s reminders, encrypted so that only this
					device can read them. No account is involved. They’re refreshed whenever you open
					Mycelium, and turning this off deletes them.
				{/if}
			</p>
			{#if reminders.pushError}<p class="notice warn" role="alert">{reminders.pushError}</p>{/if}
		</div>

		<div class="next">
			<span class="label">Coming up</span>
			{#if next.length}
				<ul>
					{#each next as r (r.id)}
						<li><time>{when(r.at)}</time> {r.title}</li>
					{/each}
				</ul>
			{:else}
				<p class="hint">Nothing in the next week.</p>
			{/if}
			<button
				type="button"
				class="btn small"
				onclick={() =>
					showReminder({
						id: `test-${Date.now()}`,
						title: 'Mycelium reminders',
						body: 'Reminders will look like this.',
						url: '#/agenda',
					})}>Send a test notification</button
			>
		</div>
	{/if}
{/if}

<style>
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.82rem;
	}
	.check {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	.check input {
		accent-color: var(--accent);
		transform: translateY(1px);
	}
	.field select {
		max-width: 16rem;
	}
	.untimed {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.time {
		width: auto;
	}
	.push,
	.next {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--border);
	}
	.next .label {
		font-size: 0.82rem;
		font-weight: 600;
	}
	.next ul {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.88rem;
	}
	.next time {
		display: inline-block;
		min-width: 7.5rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.next .btn {
		align-self: flex-start;
	}
</style>
