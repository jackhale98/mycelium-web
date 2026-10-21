# Mycelium

A fast, accessible web app for reading, linking, capturing and exploring
[org-roam](https://www.orgroam.com/) knowledge bases — straight from a git
repository on GitHub, GitLab or Bitbucket. Static site, deployed to GitHub
Pages, installable on phones.

Successor to the Tauri app [jackhale98/mycelium](https://github.com/jackhale98/mycelium).

> **Status:** preview — see [the plan](docs/PLAN.md). Sign in with GitHub,
> GitLab or Bitbucket (once [set up](docs/setup-git-providers.md)), paste an
> access token, connect Dropbox, OneDrive, SharePoint or a WebDAV server such
> as Nextcloud (once [set up](docs/setup-cloud-storage.md)), open a local
> folder (Chromium desktop), or try the built-in demo vault.

## What it does

- **Read and edit** notes, rendered from org, with a live-preview source
  editor (press <kbd>E</kbd>). Typing `[[` links to any note — or creates one.
- **Headings at a click:** TODO state, priority, tags, and SCHEDULED/DEADLINE
  dates through the native date picker. Click any date to change it.
- **Find things:** command palette (<kbd>⌘K</kbd>), full-text search with
  phrases and snippets, tags, backlinks, dailies and an agenda.
- **Graph** of the whole vault or the neighbourhood of a note.
- **Git, not a sync service.** Edits autosave to the working tree; you review
  diffs, write commit messages, and pull/push/branch when you choose
  (auto-commit is opt-in). Pulls never overwrite uncommitted work; conflicts
  get a side-by-side resolver.
- **Dropbox, OneDrive, SharePoint or WebDAV (Nextcloud…), synced
  automatically:** pick your org-roam folder and edits upload a few seconds
  later; changes from Emacs or another device come in when you open the app.
  It works offline, and edits on two devices are merged line by line
  (overlaps get the same resolver as git). Dropbox and Microsoft are called
  directly from the browser; WebDAV goes through a relay that stores nothing.
- **Local folders** (Chrome, Edge and friends on desktop): edit an org-roam
  directory in place and commit with your own tools.

## Principles

- **Your files are sacred.** Org files are parsed (with
  [uniorg](https://github.com/rasendubi/uniorg)) only to read them. Every edit
  is a minimal text patch against the original bytes — never a re-serialised
  tree — so indentation, alignment, line endings and syntax we don't understand
  survive untouched. A fidelity suite checks this against real fixtures.
- **org semantics, not approximations.** Per-file `#+TODO:` keywords, planning
  lines, `CLOSED` stamps, all three repeater styles, checkbox cookies,
  `ROAM_ALIASES`, `ROAM_REFS` and `ROAM_EXCLUDE` behave as they do in Emacs.
- **Private by design.** No backend holds your data. Tokens stay on your
  device; the sync worker is stateless, logs nothing and is self-hostable.
- **Fast and accessible.** Strict CSP, no third-party requests, self-hosted
  fonts, keyboard-first navigation and WCAG 2.1 AA checks in CI.

## Development

Requires Node 22.22+.

```sh
npm install
npm run dev          # http://localhost:4321/mycelium-web/
npm test             # unit + fidelity tests (Vitest)
npm run check        # Astro + Svelte type checks
npm run build && npm run test:e2e   # Playwright end-to-end + axe accessibility
```

Set `SITE_BASE=/` when building for a custom domain.

| Path             | What lives there                                                   |
| ---------------- | ------------------------------------------------------------------ |
| `src/lib/org`    | Pure org logic: parsing, text-patch edits, org-roam extraction     |
| `src/lib/vault`  | Vault model (backlinks, tags, agenda), layout detection and search |
| `src/lib/git`    | isomorphic-git repository, org-aware merge, browser workspace      |
| `worker`         | Stateless Cloudflare Worker: git CORS proxy and OAuth exchange     |
| `src/app`        | The Svelte app: views, components and the org renderer             |
| `src/pages`      | Astro pages: landing page and the app shell                        |
| `src/demo/vault` | The demo org-roam vault                                            |
| `tests/fixtures` | Org files used by the fidelity suite                               |

## Licence

Mycelium is free software under the [GNU General Public License v3.0 or
later](LICENSE). It renders org with [uniorg](https://github.com/rasendubi/uniorg),
which is GPL-3.0-or-later, so the app as a whole is distributed under the same
terms: you may use, study, share and change it, and anything you distribute
that is based on it must stay under the GPL with its source available.

The sync worker in [`worker/`](worker) is a separate program and stays under
the [Apache License 2.0](worker/LICENSE). Bundled third-party components and
their licences are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Not affiliated with org-roam or the GNU Emacs project.
