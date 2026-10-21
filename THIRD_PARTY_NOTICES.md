# Third-party notices

Mycelium is licensed under the [GNU GPL v3.0 or later](LICENSE). It includes
third-party software under their own licences, all compatible with the GPL:

| Component                                           | Licence          | Used for                |
| --------------------------------------------------- | ---------------- | ----------------------- |
| [uniorg](https://github.com/rasendubi/uniorg)       | GPL-3.0-or-later | Parsing org for display |
| [Svelte](https://svelte.dev)                        | MIT              | The interface           |
| [CodeMirror](https://codemirror.net)                | MIT              | The source editor       |
| [isomorphic-git](https://isomorphic-git.org)        | MIT              | Git in the browser      |
| [Dexie](https://dexie.org)                          | Apache-2.0       | Browser storage         |
| [d3](https://d3js.org) (force, zoom, drag…)         | ISC              | The graph               |
| [MiniSearch](https://lucaong.github.io/minisearch/) | MIT              | Full-text search        |
| [node-diff3](https://github.com/bhousel/node-diff3) | MIT              | Merging edits           |
| Inter, Newsreader, JetBrains Mono (via Fontsource)  | SIL OFL 1.1      | Typefaces               |

The complete list, with every licence's full text, is generated from the
exact code the browser downloads on each build and published with the site
at [`/third-party-licenses.txt`](https://my-celium.org/third-party-licenses.txt)
(see `thirdPartyLicenses` in `astro.config.mjs`).

The sync worker in [`worker/`](worker) is a separate program under the
[Apache License 2.0](worker/LICENSE).
