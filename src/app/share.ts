/// Sharing to Mycelium from another app (Web Share Target, in the manifest):
/// the shared title, text and link arrive as the app's address query, and
/// open the capture sheet with an org link ready.

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/;

/** What to put in the capture sheet for something shared. */
export function sharedText(shared: { title?: string; text?: string; url?: string }): string {
	const title = (shared.title ?? '').trim();
	let text = (shared.text ?? '').trim();
	let url = (shared.url ?? '').trim();
	// Many apps (Chrome on Android among them) put the link in the text.
	if (!url) {
		const found = URL_IN_TEXT.exec(text);
		if (found) {
			url = found[0];
			text = text.replace(found[0], '').trim();
		}
	}
	// An org link's description can't hold brackets.
	const description = title.replace(/[[\]]/g, (b) => (b === '[' ? '(' : ')'));
	const head = url ? (description ? `[[${url}][${description}]]` : `[[${url}]]`) : title;
	return [head, text === title ? '' : text].filter(Boolean).join('\n');
}

const KEYS = ['share_title', 'share_text', 'share_url'] as const;

/** Read (and remove from the address) something shared to the app, if any. */
export function takeShared(): string | null {
	const params = new URLSearchParams(location.search);
	if (!KEYS.some((k) => params.has(k))) return null;
	const text = sharedText({
		title: params.get('share_title') ?? '',
		text: params.get('share_text') ?? '',
		url: params.get('share_url') ?? '',
	});
	for (const k of KEYS) params.delete(k);
	const query = params.toString();
	history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
	return text || null;
}
