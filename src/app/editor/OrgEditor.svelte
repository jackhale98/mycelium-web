<script lang="ts">
	import type { EditorView } from '@codemirror/view';
	import { nextTodoKeyword } from '$lib/org';
	import { href, router } from '../router.svelte';
	import { app } from '../state.svelte';
	import FormatBar, { type FormatAction } from './FormatBar.svelte';

	let {
		path,
		focusAt = null,
		label = 'Org source',
	}: { path: string; focusAt?: number | null; label?: string } = $props();

	let host: HTMLDivElement | undefined = $state();
	let view: EditorView | null = null;
	let sync: ((view: EditorView, text: string) => void) | null = null;
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

	function follow(target: string) {
		if (target.startsWith('id:')) router.go(href.node(target.slice(3)));
		else if (/^https?:/.test(target)) window.open(target, '_blank', 'noopener,noreferrer');
		else {
			const id = app.vault.titles.get(target.replace(/^roam:/, '').toLowerCase());
			if (id) router.go(href.node(id));
		}
	}

	$effect(() => {
		if (!host) return;
		let cancelled = false;
		void Promise.all([
			import('./org-editor'),
			import('./format-commands'),
			import('@codemirror/commands'),
			import('./list-commands'),
			import('./table-commands'),
			import('./tex'),
		]).then(([{ createEditor, syncEditor }, format, cm, list, table, tex]) => {
			if (cancelled || !host) return;
			tables = table;
			texTools = tex;
			commands = format;
			history = cm;
			lists = list;
			sync = syncEditor;
			view = createEditor(
				host.shadowRoot ?? host.attachShadow({ mode: 'open' }),
				app.vault.file(path)?.source ?? '',
				{
					keywords: () => app.vault.file(path)?.index.keywords ?? app.vault.keywords,
					nodes: () => app.vault.nodes.values(),
					createNode: (title) => app.createNode(title),
					follow,
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
			if (focusAt !== null) {
				const at = Math.min(focusAt, view.state.doc.length);
				const lineEnd = view.state.doc.lineAt(at).to;
				view.dispatch({ selection: { anchor: lineEnd }, scrollIntoView: true });
			}
			view.focus();
		});
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
		app.tableSheet = { path, offset };
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
				run(f.insertLink);
				void import('@codemirror/autocomplete').then((a) => a.startCompletion(v));
				break;
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

	// Changes made elsewhere (a TODO toggled, a pull) flow into the editor.
	$effect(() => {
		void app.rev;
		const source = app.vault.file(path)?.source;
		if (view && sync && source !== undefined && pending === null) sync(view, source);
	});
</script>

<div class="editor" bind:this={host}></div>
<FormatBar {focused} {level} onaction={act} />

<style>
	.editor {
		min-height: 60vh;
	}
</style>
