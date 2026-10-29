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
  editor (press <kbd>E</kbd>): markup hides away from the cursor, bullets
  and checkboxes draw as such, and inline maths shows typeset (or switch to
  plain source in Settings). Typing `[[` links to any note — or creates one.
  A formatting bar (above the keyboard on phones) makes headings, TODOs,
  emphasis, lists and checkboxes without typing org markup.
- **Tabs and split view** on wide screens: ⌘/Ctrl-click a link for a new
  tab, Alt-click to open it beside; each pane reads or edits on its own, and
  each vault remembers its layout.
- **Tables, the org way:** Tab, Enter and M-arrows realign and reshape tables
  exactly as `org-table-align` does; on phones, a table sheet edits cells in a
  grid (or one row at a time) and writes the table back aligned.
- **Maths that works first time:** a formula sheet with a palette and a live
  KaTeX preview explains mistakes in plain words; in the editor the formula
  under the cursor is previewed, broken ones are underlined, and `\` offers
  commands.
- **Pictures:** add one from the camera, your photos or a file (paste or drop on
  desktop). It's offered smaller first (2000px, location data removed) to keep
  git and sync light, saved in `images/` and linked from the note.
- **Rich notes:** inline images and attachments (`attachment:` links and
  `#+ATTR_ORG` widths), LaTeX maths, highlighted source blocks, `<<targets>>`,
  `[[file::search]]` links and org-transclusion. Line breaks show as written,
  or join into paragraphs if you prefer.
- **Tasks the org way:** clock in and out with a running-clock bar and a
  clock report, refile and archive subtrees (to `%s_archive`, with org's
  archive properties), habits with their consistency graph (tap it for the
  streak, completion rate and a 4-week view, and to mark today done), and a
  time grid on today's agenda.
- **Unlinked references:** notes that mention a note's title or aliases
  without linking it, one tap from becoming a link.
- **org-roam's note tools:** rename a note (and the links that used its old
  title), add and remove aliases and refs, edit any property, and extract a
  heading into a note of its own (`org-roam-extract-subtree`), keeping its ID.
- **Headings at a click:** TODO state, priority, tags, and SCHEDULED/DEADLINE
  dates through the native date picker. Click any date to change it.
- **Capture** (<kbd>⌘/Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>) with
  org-capture-style templates: a note or task into today's daily, a journal
  entry, or a new note. On Android and desktop Chrome, Mycelium is in the
  share sheet: a shared page arrives as an org link, ready to capture.
- **Quick add in plain language:** "Call Sam tomorrow 3pm #work !A every
  week ~30m" becomes a TODO with its SCHEDULED time and repeater, tags,
  priority and Effort. What it understood shows as chips (tap × to keep
  words as they are); it works in the agenda's "Add a task…" field and any
  capture template set to read it.
- **Inbox triage and weekly review:** the inbox (a file, `inbox.org` by
  default) is processed one card at a time: done, schedule, state, refile,
  delete (with undo) or later, by tap, swipe or key. The weekly review walks
  the inbox, overdue, the next 7 days, waiting tasks, stuck projects,
  slipped habits and what got done; Home shows when you last did it.
- **Planner (time blocking):** the agenda's Plan view lays timed tasks out
  as blocks, a day at a time or (on a wide screen) a week side by side, with
  early and late hours folded away until you want them; untimed ones wait in
  a tray. Pick a task and a time (or drag it), move and resize blocks, to
  another day too (drag, toolbar or arrow keys), all written back as org
  time ranges with Undo; planned and free time are counted against your
  working hours. A task's `Effort` is its
  whole estimate: longer work is planned in sessions (timestamps in the
  task, one per stretch, which org's agenda shows on their days), with
  "5 h of 12 h" progress and "Plan the rest" to fill free time over the
  coming days. How long a "day" of effort is can match your
  `org-duration-units`.
- **Find things:** command palette (<kbd>⌘K</kbd>), full-text search with
  phrases and snippets, tags, backlinks, dailies, contents for long notes,
  and an agenda (a list, org's week view, stuck projects, a month calendar,
  or a board with a column per TODO state and rows by tag, category or
  note) with org's filters and tag/property match strings. Appointments
  (plain active timestamps in a heading's text) show on their days; drag to
  reschedule or to change state, or use the menus.
- **Graph** of the whole vault or the neighbourhood of a note.
- **Git, not a sync service.** Edits autosave to the working tree; you review
  diffs, write commit messages, and pull/push/branch when you choose
  (auto-commit is opt-in). Pulls never overwrite uncommitted work; conflicts
  get a side-by-side resolver.
- **Dropbox, OneDrive, SharePoint or WebDAV (Nextcloud…), synced
  automatically:** pick your org-roam folder and edits upload a few seconds
  later; changes from Emacs or another device come in when you open or return
  to the app, and every few minutes while it's open. Edits made while the
  connection is down upload once it's back, and edits on two devices are
  merged line by line
  (overlaps get the same resolver as git). Dropbox and Microsoft are called
  directly from the browser; WebDAV goes through a relay that stores nothing.
- **Reminders** for SCHEDULED and DEADLINE times (repeats included), with a
  task count on the app icon. Optionally they arrive while the app is closed:
  the sync worker sends the next week's reminders, encrypted on your device so
  it can't read them, with no account.
- **Works offline:** after your first visit the app opens with no connection;
  git commits wait for you to push, and cloud edits upload when you're back.
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
  device; the sync worker logs nothing, keeps nothing except the encrypted
  reminders of people who turn on reminders while closed, and is
  self-hostable.
- **Fast and accessible.** Strict CSP, no analytics and no requests beyond the
  git host or storage you connect, self-hosted fonts, keyboard-first
  navigation and WCAG 2.1 AA checks in CI.

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

| Path                                    | What lives there                                                   |
| --------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/org`                           | Pure org logic: parsing, text-patch edits, org-roam extraction     |
| `src/lib/vault`                         | Vault model (backlinks, tags, agenda), layout detection and search |
| `src/lib/git`                           | isomorphic-git repository, org-aware merge, browser workspace      |
| `src/lib/sync`                          | Sync engine for cloud storage (three-way merge, pending uploads)   |
| `src/lib/dropbox`, `onedrive`, `webdav` | Cloud storage clients                                              |
| `src/lib/auth`                          | OAuth sign-in (PKCE) for git hosts and cloud storage               |
| `src/lib/store`                         | Browser storage of vaults, settings and files (IndexedDB)          |
| `worker`                                | Stateless Cloudflare Worker: git CORS proxy, WebDAV relay, OAuth   |
| `src/app`                               | The Svelte app: views, components and the org renderer             |
| `src/pages`                             | Astro pages: landing page and the app shell                        |
| `src/demo/vault`                        | The demo org-roam vault (dated for 2026-10-20, moved to today)     |
| `tests/fixtures`                        | Org files used by the fidelity suite                               |

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
