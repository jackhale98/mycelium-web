/// Scroll a page to an org search option (`*Heading`, `#custom-id`,
/// `target`): the `<<target>>` itself when it's one, else the innermost
/// section holding the match. The spot is highlighted briefly.

import { findSearchTarget, parseSearchOption, type KeywordConfig } from '$lib/org';

export function scrollToSearch(
	root: HTMLElement,
	source: string,
	search: string,
	keywords: KeywordConfig,
): boolean {
	const option = parseSearchOption(search);
	let el: HTMLElement | null = null;
	if (option.kind === 'fuzzy')
		el = root.querySelector<HTMLElement>(
			`[data-target="${CSS.escape(option.text.replace(/\s+/g, ' ').trim().toLowerCase())}"]`,
		);
	if (!el) {
		const at = findSearchTarget(source, option, keywords);
		if (at === null) return false;
		let best = -1;
		for (const s of root.querySelectorAll<HTMLElement>('[data-pos]')) {
			const pos = Number(s.dataset['pos']);
			if (pos <= at && pos >= best) {
				best = pos;
				el = s;
			}
		}
	}
	if (!el) return false;
	el.scrollIntoView({ block: 'start', behavior: 'smooth' });
	el.classList.add('flash');
	setTimeout(() => el!.classList.remove('flash'), 1600);
	return true;
}
