/// A task's swipe actions, the same wherever it's shown (agenda rows, task
/// headings in notes):
/// - left to right: Done (Reopen on a done task), undoable;
/// - right to left: the two buttons chosen in Settings → Tasks (Schedule and
///   State unless changed), then More, which always opens the edit sheet.
/// Buttons keep their places; only a label changes (Clock in / Stop).

import { addDays } from '$lib/org';
import type { SwipeAction } from './components/SwipeRow.svelte';
import { app, localNow, type SwipeChoice } from './state.svelte';

export const SWIPE_LABELS: Record<SwipeChoice, string> = {
	schedule: 'Schedule',
	state: 'State',
	today: 'Today',
	tomorrow: 'Tomorrow',
	clock: 'Clock in',
	priority: 'Priority',
	refile: 'Refile',
	archive: 'Archive',
};

export function swipeFor(
	path: string,
	pos: number,
	todo: string | null,
): { main: SwipeAction | null; actions: SwipeAction[] } {
	const file = app.vault.file(path);
	const done = !!todo && !!file?.index.keywords.doneKeywords.includes(todo);
	const main: SwipeAction | null = !todo
		? null
		: done
			? { label: 'Reopen', icon: 'undo', tone: 'warn', run: () => app.reopenTask(path, pos) }
			: { label: 'Done', icon: 'check', run: () => app.completeTask(path, pos) };
	const today = localNow().date;
	const button = (choice: SwipeChoice): SwipeAction => {
		switch (choice) {
			case 'schedule':
				return {
					label: 'Schedule',
					icon: 'calendar',
					run: () => (app.quickSheet = { kind: 'schedule', path, pos }),
				};
			case 'state':
				return {
					label: 'State',
					icon: 'list',
					run: () => (app.quickSheet = { kind: 'state', path, pos }),
				};
			case 'today':
				return {
					label: 'Today',
					icon: 'calendar',
					run: () => app.scheduleTask(path, pos, today, 'Today'),
				};
			case 'tomorrow':
				return {
					label: 'Tomorrow',
					icon: 'calendar',
					run: () => app.scheduleTask(path, pos, addDays(today, 1), 'Tomorrow'),
				};
			case 'clock': {
				const running = app.runningClocks.some((c) => c.path === path && c.heading === pos);
				return running
					? { label: 'Stop', icon: 'clock', tone: 'warn', run: () => app.clockOut(path, pos) }
					: { label: 'Clock in', icon: 'clock', run: () => app.clockIn(path, pos) };
			}
			case 'priority':
				return {
					label: 'Priority',
					icon: 'flag',
					run: () => (app.quickSheet = { kind: 'priority', path, pos }),
				};
			case 'refile':
				return {
					label: 'Refile',
					icon: 'arrowRight',
					run: () => (app.refileSheet = { path, pos }),
				};
			case 'archive':
				return { label: 'Archive', icon: 'inbox', run: () => void app.archive(path, pos) };
		}
	};
	const actions = [
		...app.swipeTray.map(button),
		{
			label: 'More',
			icon: 'settings',
			tone: 'accent',
			run: () => (app.headingSheet = { path, pos }),
		} satisfies SwipeAction,
	];
	return { main, actions };
}
