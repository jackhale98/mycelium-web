# Mycelium Web — Plan and status

A static web app for reading, editing, linking, capturing and exploring
[org-roam](https://www.orgroam.com/) knowledge bases kept in a git repository
(GitHub, GitLab, Bitbucket or any HTTPS host), in cloud storage (Dropbox,
OneDrive, SharePoint, WebDAV such as Nextcloud) or in a local folder. Served
from Cloudflare at my-celium.org, with a copy on GitHub Pages.

Successor to the Tauri app at [jackhale98/mycelium](https://github.com/jackhale98/mycelium).
We reuse its _ideas_ (round-trip safety, conflict detection, org-roam schema,
agenda semantics) but not its UI.

## Progress

- [x] **Phase 1 — Foundation:** Astro + Svelte scaffold, design system with light/dark
      themes, CI and deploys, org layer with text-patch edits and a fidelity suite,
      demo vault with home, note, daily, agenda, tags and ⌘K search.
- [x] **Phase 2a — Git & index:** isomorphic-git clone/commit/pull/push with an org-aware
      merge and conflict resolver, token auth for GitHub/GitLab/Bitbucket/any HTTPS host,
      layout and keyword detection, IndexedDB parse cache, fast line scanner (5,000 files
      index in 0.3 s), stateless worker (git proxy + OAuth exchange).
- [x] **Phase 2b — OAuth sign-in:** GitHub App, GitLab (PKCE) and Bitbucket, token
      exchange and refresh through the worker.
- [x] **Phase 3 — Read & navigate:** graph (whole vault or local, tag colours, orphans,
      fit), backlinks with context, unlinked references, tags, full-text search page.
- [x] **Phase 4 — Edit & sync:** CodeMirror live-preview editor, `[[` completion and
      create-and-link, structured heading edits, review → commit → pull/push with a
      conflict resolver.
- [x] **Phase 5 — Capture, dailies, agenda, graph:** org-capture-style templates,
      dailies calendar, agenda with org's filters and match strings, saved views.
- [x] **Phase 6 — Polish:** mobile formatting toolbar, accessibility checks (axe in e2e),
      setup docs, and a service worker so the app opens offline.

**Since the original plan:** cloud vaults (Dropbox, OneDrive, SharePoint,
WebDAV) with automatic three-way-merging sync; local folders (File System
Access); tabs and split view on wide screens; org table editing (with a phone
table sheet); LaTeX tools (formula sheet, preview, error marks, completion);
pictures with an offer to compress; clocking with a clock report; refile and
archive; habits and the agenda time grid; TODO keyword editor; text size; hide
done items; org-transclusion and link search options.

**Not done:** a file-browser page; renaming a node with link descriptions
updated across files; `.org.gpg` handling.

## Decisions

| Area      | Decision                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework | Astro (static output) + Svelte 5; the app is a single `client:only` Svelte SPA mounted on one Astro page                                                               |
| Git       | `isomorphic-git` on `@isomorphic-git/lightning-fs` (IndexedDB)                                                                                                         |
| Transport | Git smart-HTTP through a stateless, locked-down Cloudflare Worker proxy (self-hostable); the same worker relays WebDAV                                                 |
| Auth      | OAuth sign-in: GitHub App (user-to-server tokens), GitLab OAuth (PKCE), Bitbucket OAuth; Dropbox and Microsoft with PKCE from the browser. Access tokens as a fallback |
| Sync      | Git: edits autosave to the working tree; commit (or opt-in auto-commit), pull and push are explicit. Cloud: automatic, three-way merge per file                        |
| Parsing   | `uniorg-parse` with `trackPosition: true` for rendering; a line scanner for indexing                                                                                   |
| Writing   | **Text patches only**: never re-serialise a file from an AST                                                                                                           |
| Index     | Per-file parsed index cached in IndexedDB (Dexie); the vault model (nodes, links, tags, agenda) is built in memory from it                                             |
| Search    | MiniSearch in memory for quick search; full-text search scans files on demand                                                                                          |
| Editor    | CodeMirror 6, org highlighting + live-preview decorations; separate reading view                                                                                       |
| Graph     | d3-force on the main thread, drawn on `<canvas>`                                                                                                                       |
| Offline   | Web app manifest + a service worker that stores the build's files (pages network-first, hashed files cache-first)                                                      |
| License   | GPL-3.0-or-later (uniorg, the org parser, is GPL; the worker stays Apache-2.0)                                                                                         |

## Architecture

```
┌──────────────────── Browser (my-celium.org or the GitHub Pages copy) ─────────────────────┐
│                                                                                            │
│  Svelte UI (src/app) ──► AppState ──► src/lib                                              │
│                                        ├─ org/      parse (uniorg), scanner, patch ops     │
│                                        ├─ vault/    nodes, links, agenda, search, layout   │
│                                        ├─ git/      isomorphic-git workspace, merge        │
│                                        ├─ sync/     cloud sync engine (three-way merge)    │
│                                        ├─ dropbox/ onedrive/ webdav/   service clients     │
│                                        ├─ auth/     OAuth flows (PKCE), refresh            │
│                                        └─ store/    Dexie: vaults, files, handles, …       │
│                                                                                            │
│  Storage: IndexedDB (git repo via LightningFS, parsed files, sync bases, cached pictures,  │
│           vault records with their tokens)                                                 │
└───────────────┬──────────────────────────────────────────┬─────────────────────────────────┘
                │ git smart-HTTP, WebDAV                   │ REST, direct (CORS-enabled)
                ▼                                          ▼
   ┌───────────────────────────┐              git host APIs (repo list, user),
   │ Cloudflare Worker         │              Dropbox and Microsoft Graph
   │  /<host>/<path>           │──► github.com / gitlab.com / bitbucket.org (+ EXTRA_GIT_HOSTS)
   │  /dav/<host>/<path>       │──► the user's WebDAV server
   │  /oauth/<provider>/token  │──► provider OAuth token endpoints (adds client secret)
   │  /oauth/<provider>/refresh│
   │  stateless · no logs      │
   └───────────────────────────┘
```

## File-accuracy model (the most important invariant)

1. **Read**: `uniorg-parse` with positions gives exact offsets for every element.
   A line-level scanner handles the hot paths: headlines, keywords, priority,
   tags, planning lines, property drawers.
2. **Write**: every mutation is a list of `{from, to, insert}` text changes
   against the exact source string that was loaded:
   - Editor typing: CodeMirror transactions are already minimal changes.
   - Structured ops (cycle TODO, set priority, toggle checkbox, set
     SCHEDULED/DEADLINE, add tag, add `:ID:` drawer, clock, refile, tables)
     are pure functions `(source, target) → Change[]` that touch only the
     bytes they must.
3. **Preserve**: line endings (LF/CRLF), trailing newline presence, indentation,
   keyword order and unknown syntax are never normalised.
4. **Guard**: changes from elsewhere (a pull, a cloud sync) merge with local
   edits line by line; overlaps open the conflict resolver, never a silent
   overwrite.
5. **Test**: round-trip tests assert that bytes outside each change's range
   are identical, over fixtures and a corpus of real org files (CRLF, no final
   newline, src blocks containing `*`, drawers with odd casing, Unicode tags,
   per-file `#+TODO:`).

## org-roam detection

On first open we scan the files and infer, with overrides in Settings:

- **Roam root**: the deepest folder containing every file with an `:ID:`
  (supports vaults in a subfolder of the repository).
- **Nodes**: file-level nodes (top `:PROPERTIES:` with `:ID:` + `#+title`) and
  headline nodes (headline drawer with `:ID:`). `ROAM_ALIASES`, `ROAM_REFS`,
  `ROAM_EXCLUDE` (file and node level), `#+filetags` and inherited tags.
- **Links**: `id:` links (and `roam:` / `file:` links resolved to nodes), skipping
  src/example blocks, comments and verbatim.
- **Dailies**: directory (default `daily/`) and filename format, `YYYY-MM-DD`
  or `YYYYMMDD`, detected from existing files.
- **New-node filenames**: org-roam's default `%Y%m%d%H%M%S-${slug}.org`.
- **TODO keywords**: per-file `#+TODO:` / `#+SEQ_TODO:` plus a per-vault setting.
- Capture templates are defined in-app (we cannot evaluate Emacs Lisp).

## Storage (IndexedDB / Dexie)

| Table      | Key              | Holds                                                                |
| ---------- | ---------------- | -------------------------------------------------------------------- |
| `vaults`   | `id`             | Vault record: kind (git, cloud, folder, demo), settings, credentials |
| `files`    | `vaultId + path` | Source and its scanned index (headlines, links, keywords) per file   |
| `handles`  | `id`             | File System Access handles for local folders                         |
| `syncbase` | `vaultId + path` | Last synced version of each cloud file (the merge base)              |
| `blobs`    | `vaultId + path` | Pictures downloaded from cloud vaults                                |

The git repository itself lives in LightningFS's own IndexedDB database. Only
changed files are re-scanned; the vault model is rebuilt in memory.

## Auth & Worker

**Sign-in (GitHub App example)**

1. App redirects to the provider's authorize URL with `state` + PKCE challenge
   (Bitbucket has no PKCE and uses its consumer secret instead).
2. First time: the user installs the GitHub App on chosen repositories
   (Contents: read/write, Metadata: read).
3. Provider redirects to `/<base>/auth/callback/?code&state`.
4. Browser POSTs `code` + `code_verifier` to the worker
   `/oauth/github/token`; the worker adds the client secret, calls the
   provider and returns the token JSON. Nothing is stored or logged.
5. Tokens are kept in IndexedDB on the device; refresh via
   `/oauth/<provider>/refresh`.

| Provider   | Access token | Refresh                                 |
| ---------- | ------------ | --------------------------------------- |
| GitHub App | 8 h          | refresh token ~6 months, rotated on use |
| GitLab     | 2 h          | via the worker (no secret needed)       |
| Bitbucket  | 2 h          | via the worker (needs client secret)    |

**Worker hardening**: `Origin` allowlist; git host allowlist (github.com,
gitlab.com, bitbucket.org, plus `EXTRA_GIT_HOSTS`); git path allowlist
(`/info/refs?service=git-upload-pack|git-receive-pack`, `/git-upload-pack`,
`/git-receive-pack`); WebDAV relay limited to public HTTPS hosts (optionally
`DAV_HOSTS`), WebDAV methods and credentialed requests; streaming
pass-through; logging off; no KV/D1/R2 bindings; Cloudflare rate-limit rule.
Users can deploy their own worker and set its URL in Settings.

## Sync

- **Git**: saving writes the working tree; the Changes page shows diffs, and
  the person writes a message and commits (auto-commit is opt-in). Pull merges
  per file (org-aware three-way merge) and never overwrites uncommitted work;
  conflicts open a side-by-side resolver. Push is separate. The status shows
  how far ahead/behind the branch is.
- **Cloud**: edits upload a few seconds after typing stops; checks run on
  opening, returning to and reconnecting the app, and periodically while it's
  open (slowing down while nothing changes). Uploads name the version they're
  based on; a newer one is merged line by line first.
- Storage persistence: `navigator.storage.persist()` is requested.

## UI & features

- **Home**: quick capture, what's up next, recent daily notes, recently added notes, tags.
- **Note view**: reading view (links, tables, src blocks with highlighting,
  images, maths, transclusion, folding) ⇄ live-preview editor. Backlinks with
  context and unlinked references beside the note (or below it when narrow).
- **Editor**: org highlighting, live preview of markup, links, bullets,
  checkboxes and inline maths; `[[` completion with create-and-link; a
  formatting bar (above the keyboard on phones); org table keys; pictures by
  paste, drop or picker.
- **Tabs and split view** on wide screens, remembered per vault.
- **Capture**: shortcut and templates (daily item, task, journal, new note).
- **Dailies**: calendar, previous/next, create on open.
- **Agenda & tasks**: overdue, today, upcoming; filters by tag, state,
  priority, category, text and org match strings; habits; a time grid;
  clocking; refile and archive; repeaters (`+`, `++`, `.+`) and `CLOSED:`.
- **Search**: `⌘K` quick switcher and commands, full-text search page.
- **Graph**: whole vault or local, tag colouring, orphans, zoom to fit.
- **Settings**: vault, sync proxy, roam root, dailies, TODO keywords, capture
  templates, pictures folder, theme, text size, editor mode, line breaks.

Design: light/dark/system themes via CSS custom properties, self-hosted Inter,
Newsreader and JetBrains Mono, 4.5:1 contrast minimum, visible focus rings,
`prefers-reduced-motion`, full keyboard navigation, ARIA landmarks/live regions,
44px touch targets.

Security: strict CSP (hashed scripts; `connect-src` allows HTTPS for the hosts
people connect), link schemes limited to an allowlist (no `javascript:`),
export blocks shown as code rather than rendered, the only injected HTML is
KaTeX's own output (`trust: false`), tokens never placed in URLs.

## Repository layout

```
/                        Astro project
├─ src/pages/            index.astro (landing), app.astro (SPA mount), auth/callback
├─ src/app/              Svelte SPA: components/, views/, editor/, org/ (renderer), actions/
├─ src/lib/org/          parse, scanner, patch ops, roam extraction, agenda, tables, clock
├─ src/lib/vault/        vault model, layout detection, search, graph layout, pictures
├─ src/lib/git/          isomorphic-git workspace, providers, merge, diff
├─ src/lib/sync/         cloud sync engine and workspace
├─ src/lib/dropbox/ onedrive/ webdav/   cloud clients
├─ src/lib/auth/         OAuth (PKCE) for git hosts and cloud storage
├─ src/lib/store/        Dexie schema
├─ worker/               Cloudflare Worker (git proxy, WebDAV relay, OAuth) + wrangler.jsonc
├─ tests/                fixtures, e2e (Playwright), benchmarks
└─ .github/workflows/    ci.yml (format, check, unit, build, e2e), deploy.yml (Pages), worker.yml
```

Tooling: TypeScript strict, Vitest (unit + round-trip), Playwright (e2e against
a local git server fixture, desktop and phone), Prettier, axe-core
accessibility checks in e2e. Lighthouse runs by hand.

## Open items

- Encrypted `.org.gpg` files: not handled yet.
- A file browser, and renaming a node across files.
- Self-hosted GitLab / Bitbucket Server / Gitea: access token + the host in
  the worker's `EXTRA_GIT_HOSTS`.
- Commit author identity: from the provider profile; editable in Settings.
