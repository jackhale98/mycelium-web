<script lang="ts">
	import type { EditorView } from '@codemirror/view';
	import { href, router } from '../router.svelte';
	import { app } from '../state.svelte';

	let {
		path,
		focusAt = null,
		label = 'Org source',
	}: { path: string; focusAt?: number | null; label?: string } = $props();

	let host: HTMLDivElement | undefined = $state();
	let view: EditorView | null = null;
	let sync: ((view: EditorView, text: string) => void) | null = null;
	let pending: string | null = null;
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
		void import('./org-editor').then(({ createEditor, syncEditor }) => {
			if (cancelled || !host) return;
			sync = syncEditor;
			view = createEditor(
				host.shadowRoot ?? host.attachShadow({ mode: 'open' }),
				app.vault.file(path)?.source ?? '',
				{
					keywords: () => app.vault.file(path)?.index.keywords ?? app.vault.keywords,
					nodes: () => app.vault.nodes.values(),
					createNode: (title) => app.createNode(title),
					follow,
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

	// Changes made elsewhere (a TODO toggled, a pull) flow into the editor.
	$effect(() => {
		void app.rev;
		const source = app.vault.file(path)?.source;
		if (view && sync && source !== undefined && pending === null) sync(view, source);
	});
</script>

<div class="editor" bind:this={host}></div>

<style>
	.editor {
		min-height: 60vh;
	}
</style>
