# Mycelium sync worker

A stateless Cloudflare Worker that lets the browser app talk to git hosts and
WebDAV servers.

- **Git proxy.** Browsers can't call `github.com`/`gitlab.com`/`bitbucket.org`
  git endpoints directly (no CORS). The app sends them here as
  `https://<worker>/<host>/<owner>/<repo>.git/...`. Only the three git
  smart-HTTP endpoints are forwarded, only to allow-listed hosts, and only for
  requests from allow-listed origins. Cookies and other headers are dropped.
- **OAuth token exchange** (for “Sign in with GitHub/GitLab/Bitbucket”): adds
  the client secret the browser must never hold, and returns the provider's
  response unchanged.
- **WebDAV relay** (for Nextcloud and other WebDAV vaults): most servers don't
  allow cross-origin requests, so the app sends them to
  `https://<worker>/dav/<host>/<path>`. Only `PROPFIND`, `GET`, `PUT`,
  `DELETE` and `MKCOL`; only HTTPS host names (no IP addresses, single-label
  names, or `localhost`, `.local`, `.internal`, `.lan` and `.home.arpa`
  names); only requests with credentials; bodies over 20 MB are refused (declared or
  not); redirects aren't followed. Set `DAV_HOSTS` (comma-separated host names) to allow only
  your own servers. See [docs/setup-cloud-storage.md](../docs/setup-cloud-storage.md#webdav-and-nextcloud).

It has no storage bindings and logging is disabled. Tokens pass through in
memory for the duration of a request and are never written anywhere. The free
plan (100,000 requests/day) covers roughly 20,000 syncs a day.

## Deploy (about 5 minutes)

No terminal needed: in the Cloudflare dashboard, **Workers & Pages → Create
application → Import a repository**, pick this repository, name the project
`mycelium-sync`, set the root directory to `worker` and the deploy command to
`npx wrangler@4 deploy`. Full walkthrough in
[docs/setup-git-providers.md](../docs/setup-git-providers.md#step-1--deploy-the-cloudflare-worker).

Or with Wrangler:

1. Create a free Cloudflare account, then from this folder:
   ```sh
   npx wrangler login
   npx wrangler deploy
   ```
   Wrangler prints the URL, e.g. `https://mycelium-sync.<you>.workers.dev`.
2. Edit `ALLOWED_ORIGINS` in `wrangler.jsonc` so it lists your site's
   origins (it ships with my-celium.org, www.my-celium.org,
   my-celium.fonur.workers.dev, jackhale98.github.io and localhost:4321), and
   deploy again.
3. Point the app at it with the build variable `PUBLIC_GIT_PROXY` = your
   worker URL: for a site built on Cloudflare, under the site's **Settings →
   Build → Variables and secrets**; for GitHub Pages, as an Actions
   **variable** (Settings → Secrets and variables → Actions → Variables), then
   re-run the deploy. Unset, the app uses `https://mycelium-sync.fonur.workers.dev`.
   Existing vaults can be switched in the app under Settings → Sync proxy.

To deploy from GitHub Actions instead, add a `CLOUDFLARE_API_TOKEN` secret
(token template “Edit Cloudflare Workers”) and run the **Deploy worker**
workflow.

## OAuth (when the apps are registered)

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
# likewise BITBUCKET_*; GitLab needs only GITLAB_CLIENT_ID (plus
# GITLAB_CLIENT_SECRET if its application is confidential)
```

Endpoints: `POST /oauth/<github|gitlab|bitbucket>/token` with
`{ code, code_verifier?, redirect_uri? }` (Bitbucket sends neither), and
`POST /oauth/<provider>/refresh` with `{ refresh_token, redirect_uri? }`. A
missing secret gives a 501 naming it.

## Hardening

- Add a Cloudflare rate-limiting rule for the worker route (e.g. 300
  requests/minute per IP).
- `EXTRA_GIT_HOSTS` allows self-hosted GitLab/Gitea hosts; leave it empty
  otherwise.
