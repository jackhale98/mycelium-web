# Mycelium sync worker

A stateless Cloudflare Worker that lets the browser app talk to git hosts.

- **Git proxy.** Browsers can't call `github.com`/`gitlab.com`/`bitbucket.org`
  git endpoints directly (no CORS). The app sends them here as
  `https://<worker>/<host>/<owner>/<repo>.git/...`. Only the three git
  smart-HTTP endpoints are forwarded, only to allow-listed hosts, and only for
  requests from allow-listed origins. Cookies and other headers are dropped.
- **OAuth token exchange** (for “Sign in with GitHub/GitLab/Bitbucket”): adds
  the client secret the browser must never hold, and returns the provider's
  response unchanged.

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
2. Edit `ALLOWED_ORIGINS` in `wrangler.jsonc` if your site isn't
   `https://jackhale98.github.io`, and deploy again.
3. Point the app at it: in the GitHub repository, add an Actions **variable**
   `PUBLIC_GIT_PROXY` = your worker URL (Settings → Secrets and variables →
   Actions → Variables), then re-run the Pages deploy. Existing vaults can be
   switched in the app under Settings → Sync proxy.

To deploy from GitHub Actions instead, add a `CLOUDFLARE_API_TOKEN` secret
(token template “Edit Cloudflare Workers”) and run the **Deploy worker**
workflow.

## OAuth (when the apps are registered)

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
# likewise GITLAB_* and BITBUCKET_*
```

Endpoints: `POST /oauth/<github|gitlab|bitbucket>/token` with
`{ code, code_verifier, redirect_uri }`, and `POST /oauth/<provider>/refresh`
with `{ refresh_token }`.

## Hardening

- Add a Cloudflare rate-limiting rule for the worker route (e.g. 300
  requests/minute per IP).
- `EXTRA_GIT_HOSTS` allows self-hosted GitLab/Gitea hosts; leave it empty
  otherwise.
