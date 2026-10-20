# Mycelium Web — Implementation Plan

A static, installable web app (PWA) for reading, editing, linking, capturing and
exploring [org-roam](https://www.orgroam.com/) knowledge bases stored in a git
repository on GitHub, GitLab or Bitbucket. Deployed to GitHub Pages.

Successor to the Tauri app at [jackhale98/mycelium](https://github.com/jackhale98/mycelium).
We reuse its _ideas_ (round-trip safety, conflict detection, org-roam schema,
agenda semantics) but not its UI.

## Progress

- [x] **Phase 1 — Foundation:** Astro + Svelte scaffold, design system with light/dark
      themes, CI and Pages deploy, org layer with text-patch edits and a fidelity suite,
      demo vault with home, note, daily, agenda, tags and ⌘K search.
- [ ] Phase 2 — Git, auth & index
- [ ] Phase 3 — Read & navigate (graph, unlinked mentions, file browser)
- [ ] Phase 4 — Edit & sync
- [ ] Phase 5 — Capture templates, dailies calendar, graph
- [ ] Phase 6 — Polish

## Decisions

| Area      | Decision                                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework | Astro (static output) + Svelte 5 islands; the app is a single `client:only` Svelte SPA mounted on one Astro page                                                        |
| Git       | `isomorphic-git` with a browser filesystem (OPFS, falling back to `@isomorphic-git/lightning-fs` / IndexedDB)                                                           |
| Transport | Git smart-HTTP through a stateless, locked-down Cloudflare Worker proxy (self-hostable)                                                                                 |
| Auth      | OAuth sign-in: GitHub App (user-to-server tokens), GitLab OAuth (PKCE), Bitbucket OAuth. Token exchange/refresh via the same Worker. PAT fallback for self-hosted hosts |
| Sync      | Manual **Sync** button: local commits on save, pull + merge + push on demand. Unsynced-changes badge and reminders                                                      |
| Parsing   | `uniorg-parse` with `trackPosition: true` for reading/indexing/rendering                                                                                                |
| Writing   | **Text patches only**: never re-serialise a file from an AST                                                                                                            |
| Index     | IndexedDB via Dexie, keyed by git blob OID for incremental re-indexing                                                                                                  |
| Search    | MiniSearch (fuzzy + prefix), persisted and rebuilt incrementally                                                                                                        |
| Editor    | CodeMirror 6, org language + live-preview decorations; separate reading view                                                                                            |
| Graph     | d3-force simulation in a Web Worker, rendered on `<canvas>`                                                                                                             |
| Offline   | Service worker + web app manifest; installable on iOS/Android/desktop                                                                                                   |
| License   | Apache-2.0 (matches the original project)                                                                                                                               |

## Architecture

```
┌────────────────────────── Browser (GitHub Pages origin) ──────────────────────────┐
│                                                                                    │
│  Svelte UI ──► stores ──► services                                                 │
│   │                        ├─ vault/    open, read, save (optimistic hash check)   │
│   │                        ├─ org/      parse (uniorg), patch ops, roam metadata   │
│   │                        ├─ index/    Dexie tables + MiniSearch, blob-OID diff   │
│   │                        ├─ git/      isomorphic-git: clone, commit, pull, push  │
│   │                        └─ auth/     OAuth flows, token store, refresh          │
│   │                                                                                │
│   └─ Web Workers: indexer (parse + extract), graph layout                          │
│                                                                                    │
│  Storage: OPFS (git working tree + .git), IndexedDB (index, tokens, prefs)         │
└───────────────┬──────────────────────────────────────────────┬─────────────────────┘
                │ git smart-HTTP (+ token)                     │ REST (repo list, user)
                ▼                                              ▼  direct, CORS-enabled
   ┌──────────────────────────┐                    github.com / gitlab.com / bitbucket.org APIs
   │ Cloudflare Worker        │
   │  /git/<host>/<path>      │──► github.com / gitlab.com / bitbucket.org (git endpoints)
   │  /auth/<provider>/token  │──► provider OAuth token endpoints (adds client secret)
   │  /auth/<provider>/refresh│
   │  stateless · no logs     │
   └──────────────────────────┘
```

## File-accuracy model (the most important invariant)

1. **Read**: `uniorg-parse` with positions gives exact offsets for every element.
   We also keep a thin line-level scanner (ported from the old app's
   `src/lib/org/*.ts`) for the hot paths: headline, keyword, priority, tags,
   planning lines, property drawers.
2. **Write**: every mutation is a list of `{from, to, insert}` text changes
   against the exact source string that was loaded:
   - Editor typing: CodeMirror transactions are already minimal changes.
   - Structured ops (cycle TODO, set priority, toggle checkbox, set
     SCHEDULED/DEADLINE, add tag, add `:ID:` drawer, rename link descriptions
     across files) are pure functions `(source, target) → Change[]` that touch
     only the bytes they must.
3. **Preserve**: line endings (LF/CRLF), trailing newline presence, indentation,
   keyword order and unknown syntax are never normalised.
4. **Guard**: saving compares the hash of the file as loaded with the working
   tree; mismatch → conflict UI, never a silent overwrite.
5. **Test**: property/round-trip tests assert that bytes outside each change's
   range are identical, run over the old repo's sample vault plus a corpus of
   edge cases (CRLF, no final newline, src blocks containing `*`, drawers with
   odd casing, Unicode tags, per-file `#+TODO:`).

## org-roam detection

On first open we scan the repo and infer, with overrides in Settings:

- **Roam root**: the directory containing the most files with `:ID:` drawers
  (supports vaults in a subfolder of the repo).
- **Nodes**: file-level nodes (top `:PROPERTIES:` with `:ID:` + `#+title`) and
  headline nodes (headline drawer with `:ID:`). `ROAM_ALIASES`, `ROAM_REFS`,
  `ROAM_EXCLUDE` (file and node level), `#+filetags` and inherited tags.
- **Links**: `id:` links (and `roam:` / `file:` links resolved to nodes), skipping
  src/example blocks, comments and verbatim, as the old indexer did.
- **Dailies**: directory (default `daily/`) and filename format inferred from
  existing files (`%Y-%m-%d.org` default).
- **New-node filenames**: inferred pattern, defaulting to org-roam's
  `%Y%m%d%H%M%S-${slug}.org`.
- **TODO keywords**: per-file `#+TODO:` / `#+SEQ_TODO:` plus a global setting.
- Capture templates are defined in-app (we cannot evaluate Emacs Lisp).

## Index (IndexedDB / Dexie)

Mirrors org-roam v2's schema so concepts map 1:1:

| Table       | Key              | Fields                                                                                                       |
| ----------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `files`     | `path`           | `oid` (git blob id), `title`, `mtime`, `excluded`, `todoKeywords`                                            |
| `nodes`     | `id`             | `file`, `level`, `pos`, `title`, `olp`, `todo`, `priority`, `scheduled`, `deadline`, `properties`            |
| `aliases`   | `[nodeId+alias]` |                                                                                                              |
| `tags`      | `[nodeId+tag]`   | indexed by `tag`                                                                                             |
| `refs`      | `[nodeId+ref]`   | `type`                                                                                                       |
| `links`     | auto             | `source`, `dest`, `type`, `pos`, `context` (snippet for backlinks) — indexed by `source` and `dest`          |
| `headlines` | `[file+pos]`     | all headlines incl. non-nodes, for agenda: `todo`, `priority`, `scheduled`, `deadline`, `closed`, `repeater` |
| `meta`      | key              | schema version, last indexed commit, detected config                                                         |

Incremental update: diff the working tree's blob OIDs against `files.oid`;
re-parse only changed files in the indexer worker; write in one transaction.
MiniSearch holds titles, aliases, tags and body text with snippet extraction.

## Auth & Worker

**Sign-in (GitHub App example)**

1. App redirects to the provider's authorize URL with `state` + PKCE challenge.
2. First time: the user installs the GitHub App on chosen repositories
   (Contents: read/write, Metadata: read).
3. Provider redirects to `/<base>/auth/callback?code&state`.
4. Browser POSTs `code` + `code_verifier` to the Worker `/auth/github/token`;
   the Worker adds the client secret, calls the provider, returns the token
   JSON. Nothing is stored or logged.
5. Tokens are kept in IndexedDB on the device; refresh via `/auth/<p>/refresh`.

| Provider   | Access token | Refresh                                             |
| ---------- | ------------ | --------------------------------------------------- |
| GitHub App | 8 h          | refresh token ~6 months, rotated on use             |
| GitLab     | 2 h          | PKCE public client; refresh may not need the Worker |
| Bitbucket  | 2 h          | via Worker (needs client secret)                    |

**Worker hardening**: `Origin` allowlist (our Pages origin + configured
extras); host allowlist (github.com, gitlab.com, bitbucket.org); path allowlist
(`/info/refs?service=git-upload-pack|git-receive-pack`, `/git-upload-pack`,
`/git-receive-pack`); streaming pass-through; observability/logging disabled; no
KV/D1/R2 bindings; Cloudflare rate-limit rule. Users can deploy their own Worker
and set its URL in Settings. Free tier (100k requests/day) covers ~20k syncs/day.

## Sync

- Save → write working tree → `git add` + local commit (message like
  `Update projects.org` or `Capture to 2026-10-20.org`). Batched edits to the
  same file within a session are amended into one local commit until synced.
- **Sync** button → fetch → if fast-forward, update; else three-way merge per
  file (`isomorphic-git` merge with custom `mergeDriver` for clean text merges)
  → conflicts open a side-by-side resolver → push → re-index changed files.
- Status indicator: `Synced` / `N unsynced changes` / `Behind` / `Conflict`.
  Prompt on `visibilitychange`/`beforeunload` when unsynced.
- Storage persistence: request `navigator.storage.persist()`; on iOS prompt to
  install to Home Screen (exempt from Safari's 7-day storage eviction).

## UI & features

Layout: command-centric, keyboard-first on desktop, thumb-friendly on mobile.

- **Home**: today's daily, recent nodes, agenda summary, quick capture.
- **Node view**: reading view (sanitised render: links, tables, src blocks with
  highlighting, images from the repo via blob URLs, folding) ⇄ live-preview
  editor. Right rail / bottom sheet: backlinks with context, forward links,
  unlinked mentions, outline, local graph.
- **Editor**: CodeMirror 6 with org highlighting, live-preview of
  markup/links/checkboxes, `[[` node autocomplete, create-node-and-link, TODO /
  priority / tag / date pickers, mobile formatting toolbar above the keyboard.
- **Capture**: global shortcut / floating button; templates (daily entry, new
  node, TODO into inbox).
- **Dailies**: calendar, prev/next, create-on-open.
- **Agenda & tasks**: week view, overdue, filtering by keyword/tag/priority;
  repeater semantics (`+`, `++`, `.+`) and `CLOSED:` stamping.
- **Search & quick switcher**: `⌘K`, fuzzy, snippets, tag filters.
- **Graph**: global + local, tag colouring, orphan highlighting, zoom-to-fit.
- **Refactor**: rename node and update link descriptions across files.
- **Settings**: providers/accounts, proxy URL, roam root, dailies, filename
  patterns, TODO keywords, theme, capture templates.

Design: light/dark/system themes via CSS custom properties, system font stack
plus a refined serif for reading, 4.5:1 contrast minimum, visible focus rings,
`prefers-reduced-motion`, full keyboard navigation, ARIA landmarks/live regions,
44px touch targets.

Security: strict CSP (`script-src 'self'`, `connect-src` limited to provider
APIs + proxy), DOMPurify on all rendered HTML (incl. `#+BEGIN_EXPORT html`),
`file:`/`javascript:` link schemes neutralised, tokens never placed in URLs.

## Repository layout

```
/                       Astro project
├─ src/pages/           index.astro (landing), app.astro (SPA mount), auth/callback.astro
├─ src/app/             Svelte SPA: components/, routes/, stores/
├─ src/lib/org/         parse, patch ops, roam extraction, agenda, timestamps
├─ src/lib/index/       Dexie schema, indexer worker, search
├─ src/lib/git/         isomorphic-git wrapper, fs adapter, merge
├─ src/lib/auth/        providers, PKCE, token store
├─ src/lib/editor/      CodeMirror language + extensions
├─ src/lib/graph/       layout worker + canvas renderer
├─ worker/              Cloudflare Worker (auth exchange + git proxy) + wrangler.toml
├─ tests/fixtures/      sample vaults (incl. the original Mycelium sample vault)
└─ .github/workflows/   ci.yml (lint, typecheck, test), deploy.yml (Pages), worker.yml
```

Tooling: TypeScript strict, Vitest (unit + round-trip), Playwright (e2e against a
local git server fixture), ESLint + Prettier, axe-core accessibility checks in
e2e, Lighthouse CI budget.

## Phases

1. **Foundation**: Astro + Svelte scaffold, design tokens/themes, Pages deploy
   workflow, CI. Org layer: parsing with positions, roam metadata extraction,
   patch ops, round-trip test suite. _Exit: patch ops proven byte-safe on the
   fixture corpus._
2. **Git, auth & index**: Worker (proxy + OAuth), provider adapters, clone into
   OPFS, Dexie index, indexer worker, MiniSearch, PAT fallback. _Exit: sign in,
   pick repo, clone, browse an indexed vault offline._
3. **Read & navigate**: reading view, backlinks/forward links/unlinked mentions,
   file & tag browser, quick switcher, search page.
4. **Edit & sync**: CodeMirror live-preview editor, autocomplete, structured
   edits, save + local commit, Sync with merge and conflict resolver.
5. **Capture, dailies, agenda, graph.**
6. **Polish**: PWA/offline, mobile keyboard toolbar, accessibility audit,
   performance at 5k+ notes, docs (user guide + self-hosting the Worker).

## Open items (defaults chosen; can be revisited)

- Encrypted `.org.gpg` files: shown as locked/unsupported in v1.
- Attachments (`org-attach`, images): render and insert images; upload stores
  files under `images/` (configurable).
- Self-hosted GitLab / Bitbucket Server / Gitea: PAT + custom host with a
  user-supplied proxy.
- Commit author identity: from the provider profile; editable in Settings.
