# Mycelium

A fast, accessible web app for reading, linking, capturing and exploring
[org-roam](https://www.orgroam.com/) knowledge bases — straight from a git
repository on GitHub, GitLab or Bitbucket. Static site, deployed to GitHub
Pages, installable on phones.

Successor to the Tauri app [jackhale98/mycelium](https://github.com/jackhale98/mycelium).

> **Status:** phase 1 of [the plan](docs/PLAN.md). The app runs against a
> bundled demo vault; git sign-in and sync land in phase 2.

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
  device; the planned sync proxy is stateless and self-hostable.
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

| Path             | What lives there                                               |
| ---------------- | -------------------------------------------------------------- |
| `src/lib/org`    | Pure org logic: parsing, text-patch edits, org-roam extraction |
| `src/lib/vault`  | Vault model (backlinks, tags, agenda) and search               |
| `src/app`        | The Svelte app: views, components and the org renderer         |
| `src/pages`      | Astro pages: landing page and the app shell                    |
| `src/demo/vault` | The demo org-roam vault                                        |
| `tests/fixtures` | Org files used by the fidelity suite                           |

## Licence

Apache 2.0. Not affiliated with org-roam or the GNU Emacs project.
