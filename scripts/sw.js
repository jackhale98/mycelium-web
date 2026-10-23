// @ts-nocheck (a template: the build fills in __VERSION__ and __FILES__)
/// Mycelium's service worker: the app opens with no connection.
///
/// Each build writes this file to /sw.js with the build's files filled in
/// (see `offlineApp` in astro.config.mjs). Installing it stores them all, so
/// every page and lazily loaded part (editor, graph, maths) works offline.
/// Pages come from the network when it answers within a few seconds, so an
/// update shows up on the next visit; otherwise from the stored copy.
/// Hashed build files never change, so they come from the store first. Notes
/// themselves live in the browser's own storage, not here; requests to other
/// sites (git hosts, cloud storage, the sync worker) are left alone.

const VERSION = '__VERSION__';
/** Paths relative to the site's base. */
const FILES = __FILES__;
const CACHE = `mycelium-${VERSION}`;
const NETWORK_WAIT = 4000;
// Stored copies were fetched without the headers a page sends (Origin, for
// module scripts), so look them up regardless of the server's Vary.
const MATCH = { ignoreVary: true, ignoreSearch: true };

const scope = new URL(self.registration.scope);
const url = (path) => new URL(path, scope).href;

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(FILES.map(url)))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k.startsWith('mycelium-') && k !== CACHE).map((k) => caches.delete(k)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

/** The stored page for a navigation: the app for `/app` and `/app/`, else the page itself. */
function pageKey(requestUrl) {
	const u = new URL(requestUrl);
	const path = u.pathname.slice(scope.pathname.length).replace(/\/?$/, '/');
	if (path === 'app/') return url('app/');
	if (path === '/' || path === '') return url('./');
	return null;
}

async function page(request) {
	const key = pageKey(request.url);
	const network = fetch(request).then(async (response) => {
		if (key && response.ok) await (await caches.open(CACHE)).put(key, response.clone());
		return response;
	});
	if (!key) return network;
	const match = await caches.match(key, MATCH);
	if (!match) return network;
	// A page reached through a redirect can't answer a navigation as it is.
	const stored = match.redirected ? new Response(match.body, match) : match;
	// Prefer the network (an update), but don't keep someone waiting on a bad connection.
	const late = new Promise((resolve) => setTimeout(() => resolve(stored), NETWORK_WAIT));
	return Promise.race([network.catch(() => stored), late]);
}

async function file(request) {
	const stored = await caches.match(request, MATCH);
	if (stored) return stored;
	const response = await fetch(request);
	// Keep build files that weren't stored up front (fallback font formats).
	if (response.ok && new URL(request.url).pathname.includes('/_astro/'))
		await (await caches.open(CACHE)).put(request, response.clone());
	return response;
}

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const u = new URL(request.url);
	if (u.origin !== scope.origin || !u.pathname.startsWith(scope.pathname)) return;
	if (u.pathname.startsWith(`${scope.pathname}auth/`)) return;
	event.respondWith(request.mode === 'navigate' ? page(request) : file(request));
});
