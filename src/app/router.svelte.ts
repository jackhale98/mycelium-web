/// Hash-based routing: works on GitHub Pages without server rewrites.

export type Route =
	| { name: 'home' }
	| { name: 'node'; id: string }
	| { name: 'daily'; date: string | null }
	| { name: 'agenda' }
	| { name: 'tags'; tag: string | null }
	| { name: 'vaults' }
	| { name: 'settings' }
	| { name: 'changes' }
	| { name: 'search'; q: string }
	| { name: 'graph'; id: string | null }
	| { name: 'notfound'; path: string };

export function parseHash(hash: string): Route {
	const path = decodeURIComponent(hash.replace(/^#\/?/, ''));
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
			return { name: 'agenda' };
		case 'tags':
			return { name: 'tags', tag: tail || null };
		case 'vaults':
			return { name: 'vaults' };
		case 'settings':
			return { name: 'settings' };
		case 'changes':
			return { name: 'changes' };
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
	agenda: () => '#/agenda',
	tags: (tag?: string) => (tag ? `#/tags/${encodeURIComponent(tag)}` : '#/tags'),
	vaults: () => '#/vaults',
	settings: () => '#/settings',
	changes: () => '#/changes',
	search: (q = '') => (q ? `#/search/${encodeURIComponent(q)}` : '#/search'),
	graph: (id?: string) => (id ? `#/graph/${encodeURIComponent(id)}` : '#/graph'),
};

class Router {
	route = $state<Route>({ name: 'home' });

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
