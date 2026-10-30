<script lang="ts">
	import type { EditorView } from '@codemirror/view';
	import { nextTodoKeyword } from '$lib/org';
	import { editorAnchor, restoreEditor, type Anchor } from '../anchor';
	import { href } from '../router.svelte';
	import { flushSync } from 'svelte';
	import { loadEditor } from './load';
	import { app } from '../state.svelte';
	import { panes, usePane } from '../panes.svelte';
	import FormatBar, { type FormatAction } from './FormatBar.svelte';
	import { findMentions } from '$lib/vault/mentions';

	let {
		path,
		focusAt = null,
		anchor = null,
		label = 'Org source',
		onready,
	}: {
		path: string;
		/**
		 * The editor is up: the page can take away what it showed meanwhile (the
		 * reading view), in the same frame as the editor scrolls to its place.
		 */
		onready?: () => void;
		focusAt?: number | null;
		/** Keep this part of the note where it was on screen (switching from reading). */
		anchor?: Anchor | null;
		label?: string;
	} = $props();
	const pane = usePane();

	/** Until the editor is up, the source shows as plain text in the same place. */
	let ready = $state(false);

	let outlineCycle: ((view: EditorView) => 'overview' | 'contents' | 'all') | null = null;
	/** S-TAB from the page's toolbar: fold the whole file, org's way. Returns the new state. */
	export function cycleOutline(): 'overview' | 'contents' | 'all' | undefined {
		if (!view || !outlineCycle) return undefined;
		return outlineCycle(view);
	}

	/** The line at the top of the screen (for switching back to reading). */
	export function topAnchor(container: HTMLElement): Anchor | null {
		return view ? editorAnchor(view, container) : null;
	}

	let host: HTMLDivElement | undefined = $state();
	let view: EditorView | null = null;
	let sync: ((view: EditorView, text: string) => void) | null = null;
	let refresh: ((view: EditorView) => void) | null = null;
	let linkHere: ((view: EditorView) => boolean) | null = null;
	/** A note's source URL was just pasted: offer the note's link instead. */
	let refPaste = $state<{
		from: number;
		to: number;
		url: string;
		id: string;
		title: string;
	} | null>(null);
	let refTimer: ReturnType<typeof setTimeout> | null = null;

	/** Link suggestions in the text being edited (not ones already linked from it). */
	function mentionsOf(text: string) {
		if (!app.mentionMarks) return [];
		const linked = new Set(
			[...text.matchAll(/\[\[id:([^\]\[]+?)(?:::[^\]]*)?\]/g)].map((m) => m[1]!),
		);
		return findMentions(text, app.mentionMatcher, {
			path,
			linked,
			ignore: new Set(app.mentionIgnore),
			every: app.mentionEvery,
		});
	}

	/** The note whose ROAM_REFS include this URL (as org-roam splits a ref: type and rest). */
	function refFor(url: string) {
		const m = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(url);
		if (!m) return null;
		const type = m[1]!.toLowerCase();
		const rest = m[2]!.replace(/\/$/, '');
		for (const node of app.vault.nodes.values())
			if (
				node.file !== path &&
				node.refs.some((r) => r.type === type && r.ref.replace(/\/$/, '') === rest)
			)
				return { id: node.id, title: node.title };
		return null;
	}

	function linkRef() {
		const p = refPaste;
		refPaste = null;
		if (!p || !view || view.state.sliceDoc(p.from, p.to) !== p.url) return;
		const insert = `[[id:${p.id}][${p.title}]]`;
		view.dispatch({
			changes: { from: p.from, to: p.to, insert },
			selection: { anchor: p.from + insert.length },
			userEvent: 'input',
		});
		view.focus();
	}
	let pending: string | null = null;
	let focused = $state(false);
	let level = $state(0);
	let commands: typeof import('./format-commands') | null = null;
	let history: typeof import('@codemirror/commands') | null = null;
	let lists: typeof import('./list-commands') | null = null;
	let tables: typeof import('./table-commands') | null = null;
	let texTools: typeof import('./tex') | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function save() {
		if (timer) clearTimeout(timer);
		timer = null;
		if (pending !== null) app.setSource(path, pending);
		pending = null;
	}

	function follow(target: string, beside = false) {
		if (/^https?:/.test(target)) {
			window.open(target, '_blank', 'noopener,noreferrer');
			return;
		}
		const id = target.startsWith('id:')
			? target.slice(3)
			: app.vault.titles.get(target.replace(/^roam:/, '').toLowerCase());
		if (!id) return;
		if (beside && panes.wide) panes.openBeside(pane, href.node(id));
		else pane.go(href.node(id));
	}

	$effect(() => {
		if (!host) return;
		let cancelled = false;
		void loadEditor().then(
			([
				{
					createEditor,
					syncEditor,
					refreshPreview,
					linkAtCursor,
					cycleOutline: cycle,
					startupFolds,
				},
				format,
				cm,
				list,
				table,
				tex,
			]) => {
				if (cancelled || !host) return;
				linkHere = linkAtCursor;
				outlineCycle = cycle;
				tables = table;
				texTools = tex;
				commands = format;
				history = cm;
				lists = list;
				sync = syncEditor;
				refresh = refreshPreview;
				view = createEditor(
					host.shadowRoot ?? host.attachShadow({ mode: 'open' }),
					app.vault.file(path)?.source ?? '',
					{
						keywords: () => app.vault.file(path)?.index.keywords ?? app.vault.keywords,
						livePreview: () => app.livePreview,
						nodes: () => app.vault.nodes.values(),
						createNode: (title) => app.createNode(title),
						follow,
						onImage(file, pos) {
							if (view) addImage(view, file, pos);
						},
						mentions: mentionsOf,
						linkTo(words, done) {
							app.linkPicker = {
								query: words ?? '',
								words,
								pick: done,
								cancel: () => view?.focus(),
							};
						},
						refFor,
						onRefPaste(p) {
							refPaste = p;
							if (refTimer) clearTimeout(refTimer);
							refTimer = setTimeout(() => (refPaste = null), 12_000);
						},
						onCursor(v) {
							focused = v.hasFocus;
							level = format.headingLevelAt(v.state);
						},
						onChange(text) {
							pending = text;
							if (timer) clearTimeout(timer);
							timer = setTimeout(save, 350);
						},
					},
					label,
				);
				ready = true;
				const v = view;
				// Opened by itself (not from reading, or at a heading): #+STARTUP folds.
				if (!anchor && focusAt === null) startupFolds(v);
				// The editor measures its lines in the next frame; the swap waits for
				// that, then happens before the browser paints: one move, no gap.
				requestAnimationFrame(() => {
					if (cancelled) return;
					onready?.();
					flushSync();
					if (anchor) {
						// Same place on screen as in reading: no jump.
						v.dispatch({ selection: { anchor: Math.min(anchor.pos, v.state.doc.length) } });
						restoreEditor(v, anchor);
						// The cursor is already on screen: focusing mustn't scroll to it again.
						v.contentDOM.focus({ preventScroll: true });
					} else {
						if (focusAt !== null) {
							const at = Math.min(focusAt, v.state.doc.length);
							const lineEnd = v.state.doc.lineAt(at).to;
							v.dispatch({ selection: { anchor: lineEnd }, scrollIntoView: true });
						}
						v.focus();
					}
				});
			},
		);
		return () => {
			cancelled = true;
			save();
			view?.destroy();
			view = null;
		};
	});

	const keywords = () => app.vault.file(path)?.index.keywords ?? app.vault.keywords;

	/** Cycle the TODO keyword of the cursor's heading, with org's logging and repeaters. */
	function cycleTodo(v: EditorView) {
		// A plain line becomes a heading first.
		if (commands && !commands.headingLevelAt(v.state)) commands.setHeadingLevel(1)(v);
		const line = v.state.doc.lineAt(v.state.selection.main.head);
		const m = /^\*+[ \t]+(\S+)?/.exec(line.text);
		if (!m) return;
		const config = keywords();
		const current =
			m[1] && (config.todoKeywords.includes(m[1]) || config.doneKeywords.includes(m[1]))
				? m[1]
				: null;
		save();
		app.setTodo(path, line.from, nextTodoKeyword(current, config));
	}

	let picker: HTMLInputElement | undefined = $state();

	/**
	 * Add a picture at `pos` through the picture sheet: once it's saved, its
	 * link goes on a line of its own (with a #+CAPTION: line if given), which
	 * is how org shows a picture as a figure.
	 */
	function addImage(v: EditorView, file: File, pos: number) {
		save();
		app.imageSheet = {
			file,
			note: path,
			insert(link, caption) {
				const at = Math.min(pos, v.state.doc.length);
				const line = v.state.doc.lineAt(at);
				const block = `${caption ? `#+CAPTION: ${caption}\n` : ''}${link}`;
				// On an empty line: there. Otherwise on a new line after this one.
				const empty = !line.text.trim();
				const from = empty ? line.from : line.to;
				const insert = empty ? block : `\n${block}`;
				v.dispatch({
					changes: { from, to: empty ? line.to : from, insert },
					selection: { anchor: from + insert.length },
					scrollIntoView: true,
					userEvent: 'input',
				});
			},
		};
	}

	/** An effect scrolling `pos` to the middle of the screen. */
	const centerOn = (v: EditorView, pos: number) =>
		(v.constructor as typeof EditorView).scrollIntoView(pos, { y: 'center' });

	/** In a table: edit it in the table sheet. Elsewhere: insert a new table (and edit it, on touch screens). */
	function openTable(v: EditorView) {
		if (!tables) return;
		if (!tables.tableHere(v.state)) {
			tables.insertTable(v);
			if (!matchMedia('(pointer: coarse)').matches) {
				v.focus();
				return;
			}
		}
		const offset = v.state.doc.lineAt(v.state.selection.main.head).from;
		save();
		// Let go of the keyboard first: it closing and reopening around the sheet
		// would scroll the page away. Afterwards, bring the table back into view.
		v.contentDOM.blur();
		app.tableSheet = {
			path,
			offset,
			done: () => {
				const t = tables?.tableHere(v.state);
				const at = Math.min(offset, v.state.doc.length);
				v.dispatch({
					selection: { anchor: t ? t.table.from : at },
					effects: centerOn(v, at),
				});
			},
		};
	}

	/** Write a formula in the maths sheet; edit the one at the cursor, if it's in one. */
	function openMath(v: EditorView) {
		if (!texTools) return;
		const sel = v.state.selection.main;
		const line = v.state.doc.lineAt(sel.head);
		const frag = texTools.fragmentAt(line.text, sel.head - line.from);
		const range = frag
			? { from: line.from + frag.from, to: line.from + frag.to }
			: { from: sel.from, to: sel.to };
		const selected = v.state.sliceDoc(sel.from, sel.to);
		app.mathSheet = {
			tex: frag?.tex ?? selected,
			display: frag?.display ?? false,
			editing: !!frag,
			apply(tex, display) {
				let insert = display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
				// Display maths goes on a line of its own.
				if (display && !frag) {
					const l = v.state.doc.lineAt(range.from);
					if (range.from > l.from && l.text.slice(0, range.from - l.from).trim())
						insert = `\n${insert}`;
					if (range.to < l.to && l.text.slice(range.to - l.from).trim()) insert = `${insert}\n`;
				}
				v.dispatch({
					changes: { ...range, insert },
					selection: { anchor: range.from + insert.length },
					scrollIntoView: true,
					userEvent: 'input',
				});
				v.focus();
			},
		};
	}

	function act(action: FormatAction) {
		const v = view;
		if (!v || !commands || !history || !lists) return;
		const run = (
			cmd: (t: { state: EditorView['state']; dispatch: EditorView['dispatch'] }) => boolean,
		) => cmd(v);
		const f = commands;
		switch (action) {
			case 'heading':
				run(f.cycleHeading);
				break;
			case 'todo':
				cycleTodo(v);
				break;
			case 'bold':
				run(f.toggleMark('*'));
				break;
			case 'italic':
				run(f.toggleMark('/'));
				break;
			case 'underline':
				run(f.toggleMark('_'));
				break;
			case 'strike':
				run(f.toggleMark('+'));
				break;
			case 'code':
				run(f.toggleMark('~'));
				break;
			case 'bullet':
				run(f.toggleList('bullet'));
				break;
			case 'number':
				run(f.toggleList('number'));
				break;
			case 'checkbox':
				run(f.toggleList('checkbox'));
				break;
			case 'indent':
				run(lists.indentItem);
				break;
			case 'outdent':
				run(lists.outdentItem);
				break;
			case 'link':
				// A suggestion under the cursor, or Link to… (keeping selected words).
				if (linkHere?.(v)) return;
				run(f.insertLink);
				void import('@codemirror/autocomplete').then((a) => a.startCompletion(v));
				break;
			case 'image':
				picker?.click();
				return;
			case 'table':
				openTable(v);
				return;
			case 'math':
				openMath(v);
				return;
			case 'undo':
				history.undo(v);
				break;
			case 'redo':
				history.redo(v);
				break;
			case 'done':
				v.contentDOM.blur();
				break;
		}
		if (action === 'done') return;
		v.focus();
		// Put the browser's own caret where the editor's is: Android keyboards
		// type at the DOM selection, which a toolbar tap can leave behind.
		requestAnimationFrame(() => {
			const { anchor, head } = v.state.selection.main;
			const sel = (v.root as Document).getSelection?.() ?? document.getSelection();
			const a = v.domAtPos(anchor);
			const h = v.domAtPos(head);
			sel?.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
		});
	}

	// The live preview setting takes effect at once.
	$effect(() => {
		void app.livePreview;
		if (view) refresh?.(view);
	});

	// Changes made elsewhere (a TODO toggled, a pull) flow into the editor.
	$effect(() => {
		void app.rev;
		const source = app.vault.file(path)?.source;
		if (view && sync && source !== undefined && pending === null) sync(view, source);
	});
</script>

{#if !ready}
	<pre class="fallback" aria-hidden="true">{app.vault.file(path)?.source ?? ''}</pre>
{/if}
<div class="editor" class:loading={!ready} bind:this={host}></div>
<FormatBar {focused} {level} onaction={act} />
{#if refPaste}
	<div class="ref-paste" role="status">
		<span>That's the source of <strong>{refPaste.title}</strong>.</span>
		<button type="button" class="btn small primary" onclick={linkRef}>Link the note instead</button>
		<button
			type="button"
			class="btn small icon-only"
			aria-label="Keep the URL"
			onclick={() => (refPaste = null)}>×</button
		>
	</div>
{/if}
<!-- The Picture button's file chooser: phones offer the camera and photo library. -->
<input
	bind:this={picker}
	class="sr-only"
	type="file"
	accept="image/*"
	tabindex="-1"
	aria-hidden="true"
	onchange={(e) => {
		const file = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		if (file && view) addImage(view, file, view.state.selection.main.head);
	}}
/>

<style>
	.editor {
		min-height: 60vh;
	}
	.editor.loading {
		min-height: 0;
	}
	/* Shaped like the editor's text, so nothing moves when it takes over. */
	.fallback {
		min-height: 60vh;
		margin: 0;
		padding: 0.5rem 0 40vh;
		color: var(--text);
		font-family: var(--font-read);
		font-size: 1.08rem;
		font-variant-ligatures: none;
		line-height: 1.7;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	@media (pointer: coarse) {
		.fallback {
			font-size: max(16px, 1.08rem);
		}
	}
	.ref-paste {
		position: fixed;
		left: 50%;
		bottom: calc(1rem + env(safe-area-inset-bottom));
		z-index: 40;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.4rem 0.6rem;
		width: max-content;
		max-width: calc(100vw - 2rem);
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		box-shadow: var(--shadow-lg);
		font-size: 0.86rem;
		transform: translateX(-50%);
	}
	@media (max-width: 960px) {
		/* Above the formatting bar and the keyboard. */
		.ref-paste {
			top: calc(0.75rem + env(safe-area-inset-top));
			bottom: auto;
		}
	}
</style>
