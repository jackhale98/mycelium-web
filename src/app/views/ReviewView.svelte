<script lang="ts">
	// The weekly review (GTD), a step at a time: the inbox, what's overdue,
	// what's coming up, what's waiting on others, stuck projects, habits that
	// slipped, and what got done. Each list's rows work like the agenda's
	// (swipe, edit, change dates). Finishing remembers the day; Home shows how
	// long ago that was.
	import { addDays, habitStats, isHabit, parseHabit } from '$lib/org';
	import type { AgendaItem } from '$lib/vault/vault';
	import { groupAgenda, stuckProjects, stuckSettingsOf } from '../agenda';
	import AgendaList from '../components/AgendaList.svelte';
	import Icon from '../components/Icon.svelte';
	import { href } from '../router.svelte';
	import { app, localNow } from '../state.svelte';
	import { relativeDay } from '../util';

	const today = localNow().date;

	const data = $derived.by(() => {
		void app.rev;
		const groups = groupAgenda(app.vault, today, 7);
		const all = app.vault.agenda();
		const weekAgo = addDays(today, -6);
		const waiting = all.filter((i) => i.todo && app.waitKeywords.includes(i.todo));
		let stuck: AgendaItem[] = [];
		try {
			stuck = stuckProjects(app.vault, stuckSettingsOf(app.activeVault?.stuckProjects), localNow());
		} catch {
			// A broken stuck-project setting shouldn't stop the review.
		}
		const slipped = all.filter((i) => {
			if (!i.scheduled?.repeater || app.vault.isDone(i.todo, i.file)) return false;
			const file = app.vault.file(i.file);
			if (!file || !isHabit(file.source, i.pos, file.index.keywords)) return false;
			const h = parseHabit(file.source, i.pos, file.index.keywords);
			return !!h && habitStats(h, today).streak === 0;
		});
		const done = groups.done.filter((i) => (i.closed?.date ?? '') >= weekAgo);
		return {
			overdue: groups.overdue,
			coming: [...groups.today, ...groups.upcoming],
			waiting,
			stuck,
			slipped,
			done,
		};
	});

	type Step = {
		id: string;
		title: string;
		hint: string;
		items?: AgendaItem[];
		empty?: string;
	};
	const steps = $derived<Step[]>([
		{
			id: 'inbox',
			title: 'Empty the inbox',
			hint: 'Decide what each thing is and where it goes.',
		},
		{
			id: 'overdue',
			title: 'Overdue',
			hint: 'Do it, give it a new date, or let it go.',
			items: data.overdue,
			empty: 'Nothing overdue.',
		},
		{
			id: 'coming',
			title: 'Coming up',
			hint: 'The next 7 days: anything to prepare or move?',
			items: data.coming,
			empty: 'Nothing scheduled for the week.',
		},
		{
			id: 'waiting',
			title: 'Waiting on others',
			hint: app.waitKeywords.length
				? `Tasks in ${app.waitKeywords.join(', ')}: anyone to nudge?`
				: 'No waiting states: choose them in Settings → Tasks.',
			items: data.waiting,
			empty: 'Nothing waiting.',
		},
		{
			id: 'stuck',
			title: 'Stuck projects',
			hint: 'Projects with no next action: give each one a next step.',
			items: data.stuck,
			empty: 'Every project has a next step.',
		},
		{
			id: 'habits',
			title: 'Habits',
			hint: 'Streaks that broke: start again today?',
			items: data.slipped,
			empty: 'Every habit is on track.',
		},
		{
			id: 'done',
			title: 'Done this week',
			hint: 'What got done in the last 7 days.',
			items: data.done,
			empty: 'Nothing closed this week yet.',
		},
	]);

	let index = $state(0);
	let finished = $state(false);
	const step = $derived(steps[index]!);
	const last = $derived(index === steps.length - 1);

	async function finish() {
		await app.finishReview();
		finished = true;
	}
	const ago = $derived(app.lastReview ? relativeDay(app.lastReview, today) : null);
</script>

<div class="review">
	<header>
		<p class="eyebrow">Weekly review</p>
		<h1>{finished ? 'Review done' : step.title}</h1>
		{#if !finished}
			<ol class="dots" aria-label="Steps">
				{#each steps as s, i (s.id)}
					<li>
						<button
							type="button"
							aria-current={i === index ? 'step' : undefined}
							aria-label={`${i + 1}. ${s.title}${s.items ? ` (${s.items.length})` : ''}`}
							title={s.title}
							onclick={() => (index = i)}><span></span></button
						>
					</li>
				{/each}
			</ol>
		{/if}
	</header>

	{#if finished}
		<div class="done">
			<p class="big"><Icon name="check" size={22} /> All reviewed</p>
			<p>Next one in a week. Nice work.</p>
			<p class="links">
				<a class="btn primary" href={href.agenda()}>Agenda</a>
				<a class="btn" href={href.home()}>Home</a>
			</p>
		</div>
	{:else}
		<p class="hint">{step.hint}</p>
		{#if step.id === 'inbox'}
			<div class="inbox">
				{#if !app.inboxPath}
					<p>
						No inbox file yet: choose one in <a href={href.settings('tasks')}>Settings → Tasks</a>.
					</p>
				{:else if app.inbox.length}
					<p class="count">
						<strong>{app.inbox.length}</strong>
						{app.inbox.length === 1 ? 'thing' : 'things'} in the inbox.
					</p>
					<a class="btn primary" href={href.triage()}>Process the inbox</a>
				{:else}
					<p class="count"><Icon name="check" size={18} /> The inbox is empty.</p>
				{/if}
			</div>
		{:else}
			<section aria-labelledby="review-step">
				<h2 id="review-step" class="sr-only">{step.title}</h2>
				<AgendaList items={step.items ?? []} {today} empty={step.empty ?? 'Nothing here.'} />
			</section>
		{/if}

		<nav class="steps" aria-label="Review steps">
			<button type="button" class="btn" disabled={index === 0} onclick={() => (index -= 1)}
				><Icon name="chevronLeft" size={16} />Back</button
			>
			<span class="where">{index + 1} of {steps.length}</span>
			{#if last}
				<button type="button" class="btn primary" onclick={finish}>Finish review</button>
			{:else}
				<button type="button" class="btn primary" onclick={() => (index += 1)}
					>Next<Icon name="chevronRight" size={16} /></button
				>
			{/if}
		</nav>
		{#if ago}<p class="last">Last review: {ago.toLowerCase()}</p>{/if}
	{/if}
</div>

<style>
	.review {
		max-width: 46rem;
		margin: 0 auto;
		padding: 3.25rem 2rem 6rem;
	}
	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0;
		font-family: var(--font-read);
		font-size: 2.2rem;
		font-weight: 600;
	}
	.dots {
		display: flex;
		gap: 0.15rem;
		margin: 0.75rem 0 0;
		padding: 0;
		list-style: none;
	}
	.dots button {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: 0;
		background: none;
	}
	.dots span {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 999px;
		background: var(--border-strong);
	}
	.dots button[aria-current='step'] span {
		width: 1.4rem;
		background: var(--accent);
	}
	.hint {
		margin: 1rem 0 0.75rem;
		color: var(--text-2);
	}
	.inbox {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 1.1rem 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	.inbox p {
		margin: 0;
	}
	.count {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 1.05rem;
	}
	.steps {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}
	.where,
	.last {
		color: var(--text-muted);
		font-size: 0.85rem;
	}
	.last {
		margin: 0.75rem 0 0;
		text-align: center;
	}
	.done {
		padding: 2rem 1.25rem;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-lg);
		text-align: center;
	}
	.done .big {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		color: var(--accent);
		font-size: 1.25rem;
		font-weight: 650;
	}
	.links {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
	}
	@media (max-width: 720px) {
		.review {
			padding: 1.75rem 1rem 6rem;
		}
		h1 {
			font-size: 1.8rem;
		}
	}
</style>
