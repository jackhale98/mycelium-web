/// Hash-based routing: works on GitHub Pages without server rewrites.

export type Route =
	| { name: 'home' }
	| { name: 'node'; id: string }
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
			return tail ? { name: 'node', id: tail } : { name: 'notfound', path };
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

export const href = {
	home: () => '#/',
	node: (id: string) => `#/node/${encodeURIComponent(id)}`,
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
	route = $state<Route>(
		typeof location === 'undefined' ? { name: 'home' } : parseHash(location.hash),
	);

	start() {
		const sync = () => {
			this.route = parseHash(location.hash);
		};
		sync();
		addEventListener('hashchange', sync);
		return () => removeEventListener('hashchange', sync);
	}

	go(hash: string) {
		location.hash = hash;
	}
}

export const router = new Router();
