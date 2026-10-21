/// The editor's code, fetched once. Reading views call this when the
/// browser is idle, so switching to Edit shows the editor straight away.

let modules: ReturnType<typeof fetchAll> | null = null;

function fetchAll() {
	return Promise.all([
		import('./org-editor'),
		import('./format-commands'),
		import('@codemirror/commands'),
		import('./list-commands'),
		import('./table-commands'),
		import('./tex'),
	]);
}

export function loadEditor() {
	modules ??= fetchAll().catch((e) => {
		modules = null; // a failed download is tried again next time
		throw e;
	});
	return modules;
}

/** Fetch the editor in the background, once the page has settled. */
export function preloadEditor() {
	const go = () => void loadEditor().catch(() => undefined);
	if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 5000 });
	else setTimeout(go, 2000);
}
