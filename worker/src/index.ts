/// Mycelium sync worker — stateless, no storage, no logging.
///
/// 1. Git proxy: browsers cannot call git hosts' smart-HTTP endpoints (no
///    CORS), so isomorphic-git sends them here as `/<host>/<repo path>`. Only
///    the three git endpoints, only allow-listed hosts, only from allow-listed
///    origins. Bodies are streamed straight through.
/// 2. OAuth: exchanges an authorization code (or refresh token) for tokens,
///    adding the client secret the browser must not hold, and returns the
///    provider's response unchanged.

export interface Env {
	/** Comma-separated origins allowed to use the worker, e.g. `https://you.github.io`. */
	ALLOWED_ORIGINS: string;
	/** Optional comma-separated extra git hosts (self-hosted GitLab, Gitea, …). */
	EXTRA_GIT_HOSTS?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	GITLAB_CLIENT_ID?: string;
	GITLAB_CLIENT_SECRET?: string;
	BITBUCKET_CLIENT_ID?: string;
	BITBUCKET_CLIENT_SECRET?: string;
}

const GIT_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'];

/** Request headers git needs; everything else (cookies, …) is dropped. */
const FORWARD_REQUEST = [
	'accept',
	'authorization',
	'content-type',
	'content-encoding',
	'git-protocol',
];
const FORWARD_RESPONSE = [
	'content-type',
	'content-encoding',
	'cache-control',
	'expires',
	'pragma',
	'www-authenticate',
];

const OAUTH: Record<string, { token: string; basicAuth: boolean }> = {
	github: { token: 'https://github.com/login/oauth/access_token', basicAuth: false },
	gitlab: { token: 'https://gitlab.com/oauth/token', basicAuth: false },
	bitbucket: { token: 'https://bitbucket.org/site/oauth2/access_token', basicAuth: true },
};

function list(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function cors(origin: string, extra: Record<string, string> = {}): Headers {
	return new Headers({
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers':
			'Authorization, Content-Type, Content-Encoding, Git-Protocol, Accept',
		'Access-Control-Expose-Headers': 'Content-Type, WWW-Authenticate',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
		'Cache-Control': 'no-store',
		...extra,
	});
}

const deny = (status: number, message: string, origin?: string) =>
	new Response(message, {
		status,
		headers: origin
			? cors(origin, { 'Content-Type': 'text/plain' })
			: { 'Content-Type': 'text/plain' },
	});

/** `true` for the three smart-HTTP endpoints git clients use. */
export function isGitRequest(method: string, path: string, search: URLSearchParams): boolean {
	if (method === 'GET' && path.endsWith('/info/refs')) {
		const service = search.get('service');
		return service === 'git-upload-pack' || service === 'git-receive-pack';
	}
	return (
		method === 'POST' && (path.endsWith('/git-upload-pack') || path.endsWith('/git-receive-pack'))
	);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const origin = request.headers.get('Origin');
		if (!origin || !list(env.ALLOWED_ORIGINS).includes(origin))
			return deny(403, 'Origin not allowed');
		if (request.method === 'OPTIONS')
			return new Response(null, { status: 204, headers: cors(origin) });

		if (url.pathname.startsWith('/oauth/')) return oauth(request, env, url, origin);

		// Git proxy: /<host>/<owner>/<repo>.git/<endpoint>
		const [, host, ...rest] = url.pathname.split('/');
		const hosts = [...GIT_HOSTS, ...list(env.EXTRA_GIT_HOSTS)];
		if (!host || !hosts.includes(host)) return deny(403, 'Git host not allowed', origin);
		const path = `/${rest.join('/')}`;
		if (path.includes('..') || !isGitRequest(request.method, path, url.searchParams))
			return deny(403, 'Only git smart-HTTP requests are proxied', origin);

		const headers = new Headers({ 'User-Agent': 'git/mycelium-proxy' });
		for (const name of FORWARD_REQUEST) {
			const value = request.headers.get(name);
			if (value) headers.set(name, value);
		}
		const upstream = await fetch(`https://${host}${path}${url.search}`, {
			method: request.method,
			headers,
			body: request.method === 'POST' ? request.body : null,
			redirect: 'follow',
		});
		const out = cors(origin);
		for (const name of FORWARD_RESPONSE) {
			const value = upstream.headers.get(name);
			if (value) out.set(name, value);
		}
		return new Response(upstream.body, { status: upstream.status, headers: out });
	},
} satisfies { fetch(request: Request, env: Env): Promise<Response> };

/**
 * POST /oauth/<provider>/token   { code, code_verifier?, redirect_uri }
 * POST /oauth/<provider>/refresh { refresh_token }
 */
async function oauth(request: Request, env: Env, url: URL, origin: string): Promise<Response> {
	const [, , provider, action] = url.pathname.split('/');
	const config = provider ? OAUTH[provider] : undefined;
	if (!config || (action !== 'token' && action !== 'refresh') || request.method !== 'POST')
		return deny(404, 'Unknown OAuth endpoint', origin);
	const prefix = provider!.toUpperCase() as 'GITHUB' | 'GITLAB' | 'BITBUCKET';
	const clientId = env[`${prefix}_CLIENT_ID`];
	const secret = env[`${prefix}_CLIENT_SECRET`];
	if (!clientId || !secret)
		return deny(501, `${provider} sign-in is not configured on this worker`, origin);

	let input: Record<string, unknown>;
	try {
		input = (await request.json()) as Record<string, unknown>;
	} catch {
		return deny(400, 'Expected a JSON body', origin);
	}
	const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
	const form = new URLSearchParams();
	if (action === 'token') {
		const code = str('code');
		if (!code) return deny(400, 'Missing code', origin);
		form.set('grant_type', 'authorization_code');
		form.set('code', code);
		if (str('redirect_uri')) form.set('redirect_uri', str('redirect_uri')!);
		if (str('code_verifier')) form.set('code_verifier', str('code_verifier')!);
	} else {
		const refresh = str('refresh_token');
		if (!refresh) return deny(400, 'Missing refresh_token', origin);
		form.set('grant_type', 'refresh_token');
		form.set('refresh_token', refresh);
	}
	const headers: Record<string, string> = {
		Accept: 'application/json',
		'Content-Type': 'application/x-www-form-urlencoded',
	};
	if (config.basicAuth) headers['Authorization'] = `Basic ${btoa(`${clientId}:${secret}`)}`;
	else {
		form.set('client_id', clientId);
		form.set('client_secret', secret);
	}
	const upstream = await fetch(config.token, { method: 'POST', headers, body: form });
	return new Response(upstream.body, {
		status: upstream.status,
		headers: cors(origin, {
			'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
		}),
	});
}
