/// Hash-based routing: works on GitHub Pages without server rewrites.

export type Route =
	| { name: 'home' }
	/** `at`: an org search option to scroll to (`*Heading`, `#custom-id`, `target`). */
	| { name: 'node'; id: string; at: string | null }
	/** An org file with no `:ID:` (not an org-roam node), by vault path. */
	| { name: 'file'; path: string; at: string | null }
	| { name: 'daily'; date: string | null }
	| { name: 'agenda'; query: string }
	| { name: 'tags'; tag: string | null }
	| { name: 'vaults' }
	| { name: 'settings' }
	| { name: 'changes' }
	| { name: 'dailies' }
	| { name: 'search'; q: string }
	| { name: 'graph'; id: string | null }
	| { name: 'notfound'; path: string };

export function parseHash(hash: string): Route {
	const raw = hash.replace(/^#\/?/, '');
	// A query (`#/agenda?tag=work`) is kept as-is for the page to decode.
	const at = raw.indexOf('?');
	const query = at === -1 ? '' : raw.slice(at + 1);
	const path = decodeURIComponent(at === -1 ? raw : raw.slice(0, at));
	const [head = '', ...rest] = path.split('/');
	const tail = rest.join('/');
	switch (head) {
		case '':
			return { name: 'home' };
		case 'node':
			return tail ? { name: 'node', id: tail, at: searchAt(query) } : { name: 'notfound', path };
		case 'file':
			return tail ? { name: 'file', path: tail, at: searchAt(query) } : { name: 'notfound', path };
		case 'daily':
			return { name: 'daily', date: /^\d{4}-\d{2}-\d{2}$/.test(tail) ? tail : null };
		case 'agenda':
			return { name: 'agenda', query };
		case 'tags':
			return { name: 'tags', tag: tail || null };
		case 'vaults':
			return { name: 'vaults' };
		case 'settings':
			return { name: 'settings' };
		case 'changes':
			return { name: 'changes' };
		case 'dailies':
			return { name: 'dailies' };
		case 'search':
			return { name: 'search', q: tail };
		case 'graph':
			return { name: 'graph', id: tail || null };
		default:
			return { name: 'notfound', path };
	}
}

const searchAt = (query: string) => new URLSearchParams(query).get('at');
const withAt = (base: string, at?: string | null) =>
	at ? `${base}?${new URLSearchParams({ at }).toString()}` : base;

export const href = {
	home: () => '#/',
	node: (id: string, at?: string | null) => withAt(`#/node/${encodeURIComponent(id)}`, at),
	file: (path: string, at?: string | null) =>
		withAt(`#/file/${path.split('/').map(encodeURIComponent).join('/')}`, at),
	daily: (date?: string) => (date ? `#/daily/${date}` : '#/daily'),
	agenda: (query = '') => (query ? `#/agenda?${query}` : '#/agenda'),
	tags: (tag?: string) => (tag ? `#/tags/${encodeURIComponent(tag)}` : '#/tags'),
	vaults: () => '#/vaults',
	settings: () => '#/settings',
	changes: () => '#/changes',
	dailies: () => '#/dailies',
	search: (q = '') => (q ? `#/search/${encodeURIComponent(q)}` : '#/search'),
	graph: (id?: string) => (id ? `#/graph/${encodeURIComponent(id)}` : '#/graph'),
};

class Router {
	// Start on the requested page, so nothing renders the home page first.
	/** The address bar's page (the main pane's). */
	url = $state<Route>(
		typeof location === 'undefined' ? { name: 'home' } : parseHash(location.hash),
	);
	/** With split view, the pane you're working in: what `route` and `go` mean. */
	focus = $state<{ route: Route; go(hash: string): void } | null>(null);

	/** The page you're on (in split view, the focused pane's). */
	get route(): Route {
		return this.focus?.route ?? this.url;
	}

	start() {
		const sync = () => {
			this.url = parseHash(location.hash);
		};
		sync();
		addEventListener('hashchange', sync);
		return () => removeEventListener('hashchange', sync);
	}

	/** Go to `hash` in the pane you're working in. */
	go(hash: string) {
		if (this.focus) this.focus.go(hash);
		else this.navigate(hash);
	}

	/** Change the address bar (the main pane's page). */
	navigate(hash: string) {
		location.hash = hash;
	}
}

export const router = new Router();
