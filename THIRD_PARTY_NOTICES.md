# Third-party notices

Mycelium is licensed under the [GNU GPL v3.0 or later](LICENSE). It includes
third-party software under their own licences, all compatible with the GPL:

| Component                                                                  | Licence                                            | Used for                |
| -------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------- |
| [uniorg-parse](https://github.com/rasendubi/uniorg) (uniorg), with unified | GPL-3.0-or-later; unified MIT                      | Parsing org for display |
| [Svelte](https://svelte.dev)                                               | MIT                                                | The interface           |
| [CodeMirror](https://codemirror.net) and Lezer                             | MIT                                                | The source editor       |
| [isomorphic-git](https://isomorphic-git.org), lightning-fs, buffer         | MIT, with some Apache-2.0 and BSD-3-Clause helpers | Git in the browser      |
| [Dexie](https://dexie.org)                                                 | Apache-2.0                                         | Browser storage         |
| [d3](https://d3js.org) (force, zoom, drag…)                                | ISC (d3-ease: BSD-3-Clause)                        | The graph               |
| [MiniSearch](https://lucaong.github.io/minisearch/)                        | MIT                                                | Quick search            |
| [node-diff3](https://github.com/bhousel/node-diff3)                        | MIT                                                | Merging edits           |
| [KaTeX](https://katex.org) (with its fonts)                                | MIT                                                | LaTeX maths             |
| CodeMirror language modes (`@codemirror/lang-*`, `legacy-modes`)           | MIT                                                | Highlighting src blocks |
| [Lucide](https://lucide.dev) (icons, adapted)                              | ISC                                                | Interface icons         |
| Inter, Newsreader, JetBrains Mono (via Fontsource)                         | SIL OFL 1.1                                        | Typefaces               |

Smaller helper packages (MIT, ISC, BSD-3-Clause, Zlib and Apache-2.0, among
them pako and sha.js) are in the complete list. That list, with every
licence's full text, is generated from the exact code the browser downloads
on each build and published with the site at
[`/third-party-licenses.txt`](https://my-celium.org/third-party-licenses.txt)
(see `thirdPartyLicenses` in `astro.config.mjs`).

The sync worker in [`worker/`](worker) is a separate program under the
[Apache License 2.0](worker/LICENSE).
