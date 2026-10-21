<script lang="ts">
	// Time clocked per heading over a day or a week, as org-agenda's clock
	// report shows it (weeks start on Monday, org-agenda-start-on-weekday).
	import { addDays, clockEntries, dayNameFor, formatDuration } from '$lib/org';
	import { app } from '../state.svelte';

	let { today }: { today: string } = $props();
	let span = $state<'day' | 'week'>('day');

	const range = $derived.by(() => {
		const [y, m, d] = today.split('-').map(Number) as [number, number, number];
		if (span === 'day')
			return { start: new Date(y, m - 1, d).getTime(), end: new Date(y, m - 1, d + 1).getTime() };
		const back =
			(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(dayNameFor(today)) + 7) % 7;
		const monday = addDays(today, -back);
		const [my, mm, md] = monday.split('-').map(Number) as [number, number, number];
		return {
			start: new Date(my, mm - 1, md).getTime(),
			end: new Date(my, mm - 1, md + 7).getTime(),
		};
	});

	const report = $derived.by(() => {
		void app.rev;
		const files: {
			path: string;
			title: string;
			entries: ReturnType<typeof clockEntries>;
			total: number;
		}[] = [];
		for (const file of app.vault.files.values()) {
			const entries = clockEntries(file.source, file.index.keywords, range);
			if (!entries.length) continue;
			files.push({
				path: file.path,
				title: file.index.title || file.path,
				entries,
				total: entries.reduce((n, e) => n + e.minutes, 0),
			});
		}
		files.sort((a, b) => b.total - a.total);
		return { files, total: files.reduce((n, f) => n + f.total, 0) };
	});
</script>

<section class="group" aria-labelledby="ag-clock">
	<h2 id="ag-clock">
		Clocked<span class="count">{formatDuration(report.total)}</span>
		<span class="spans" role="radiogroup" aria-label="Clock report span">
			<button
				type="button"
				role="radio"
				aria-checked={span === 'day'}
				onclick={() => (span = 'day')}>Today</button
			>
			<button
				type="button"
				role="radio"
				aria-checked={span === 'week'}
				onclick={() => (span = 'week')}>This week</button
			>
		</span>
	</h2>
	{#if report.files.length === 0}
		<p class="empty">No time clocked {span === 'day' ? 'today' : 'this week'}.</p>
	{:else}
		<table class="report">
			<thead><tr><th scope="col">Heading</th><th scope="col" class="num">Time</th></tr></thead>
			{#each report.files as f (f.path)}
				<tbody>
					<tr class="file"
						><th scope="row">{f.title}</th><td class="num">{formatDuration(f.total)}</td></tr
					>
					{#each f.entries as e (e.heading)}
						<tr>
							<td style:padding-left={`${0.6 + (e.level - 1) * 0.9}rem`}>{e.title}</td>
							<td class="num">{formatDuration(e.minutes)}</td>
						</tr>
					{/each}
				</tbody>
			{/each}
		</table>
	{/if}
</section>

<style>
	.spans {
		display: inline-flex;
		gap: 0.25rem;
		margin-left: auto;
	}
	.spans button {
		padding: 0.15rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: none;
		color: var(--text-muted);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.spans button[aria-checked='true'] {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent-strong);
	}
	.empty {
		margin: 0;
		padding: 0.9rem 0;
		color: var(--text-faint);
		font-size: 0.88rem;
	}
	.report {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.86rem;
	}
	.report th,
	.report td {
		padding: 0.3rem 0.6rem;
		border-bottom: 1px solid var(--border);
		text-align: left;
	}
	.report thead th {
		color: var(--text-muted);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.report .file th,
	.report .file td {
		font-weight: 650;
	}
	.num {
		text-align: right !important;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
