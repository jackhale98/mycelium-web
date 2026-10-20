/// An in-memory view of an indexed vault: node lookup, backlinks, tags and
/// agenda entries. Built from `FileIndex` records, so the same structure backs
/// the bundled demo and (later) a git checkout indexed in IndexedDB.

import {
	indexFile,
	type FileIndex,
	type HeadlineEntry,
	type KeywordConfig,
	type RoamLink,
	type RoamNode,
} from '$lib/org';
import { DEFAULT_KEYWORD_CONFIG } from '$lib/org/types';

export interface VaultFile {
	path: string;
	source: string;
	index: FileIndex;
}

export interface Backlink extends RoamLink {
	/** The node the link sits in. */
	from: RoamNode;
}

export interface AgendaItem extends HeadlineEntry {
	file: string;
	/** The node to open for this item (its own, or the innermost containing one). */
	node: RoamNode | null;
}

export class Vault {
	readonly files = new Map<string, VaultFile>();
	readonly nodes = new Map<string, RoamNode>();
	readonly backlinks = new Map<string, Backlink[]>();
	readonly tags = new Map<string, Set<string>>();
	/** Lower-cased titles and aliases → node id, for `roam:` links and lookups. */
	readonly titles = new Map<string, string>();
	/** Node ids defined in more than one place: org-roam would reject these. */
	readonly duplicates = new Set<string>();

	constructor(readonly keywords: KeywordConfig = DEFAULT_KEYWORD_CONFIG) {}

	/** Build from already-indexed files (e.g. the IndexedDB cache) without re-parsing. */
	static fromIndexed(
		files: Iterable<VaultFile>,
		keywords: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
	): Vault {
		const vault = new Vault(keywords);
		for (const file of files) vault.files.set(file.path, file);
		vault.rebuild();
		return vault;
	}

	static fromSources(
		sources: Record<string, string>,
		keywords: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
	): Vault {
		const vault = new Vault(keywords);
		for (const [path, source] of Object.entries(sources))
			vault.files.set(path, { path, source, index: indexFile(path, source, keywords) });
		vault.rebuild();
		return vault;
	}

	/** Replace one file and recompute derived maps. Returns the new file record. */
	update(path: string, source: string): VaultFile {
		const file = { path, source, index: indexFile(path, source, this.keywords) };
		this.files.set(path, file);
		this.rebuild();
		return file;
	}

	/** Apply several additions, updates and removals with one rebuild. */
	apply(changes: { path: string; source: string | null }[]): VaultFile[] {
		const updated: VaultFile[] = [];
		for (const { path, source } of changes) {
			if (source === null) this.files.delete(path);
			else {
				const file = { path, source, index: indexFile(path, source, this.keywords) };
				this.files.set(path, file);
				updated.push(file);
			}
		}
		this.rebuild();
		return updated;
	}

	private rebuild() {
		this.nodes.clear();
		this.backlinks.clear();
		this.tags.clear();
		this.titles.clear();
		this.duplicates.clear();
		for (const file of this.files.values()) {
			if (file.index.excluded) continue;
			for (const node of file.index.nodes) {
				if (this.nodes.has(node.id)) this.duplicates.add(node.id);
				else this.nodes.set(node.id, node);
				for (const name of [node.title, ...node.aliases]) {
					const key = name.toLowerCase();
					if (!this.titles.has(key)) this.titles.set(key, node.id);
				}
				for (const tag of node.tags) {
					if (!this.tags.has(tag)) this.tags.set(tag, new Set());
					this.tags.get(tag)!.add(node.id);
				}
			}
		}
		for (const file of this.files.values()) {
			for (const link of file.index.links) {
				const dest = this.resolve(link);
				const from = this.nodes.get(link.source);
				if (!dest || !from || dest === link.source) continue;
				if (!this.backlinks.has(dest)) this.backlinks.set(dest, []);
				this.backlinks.get(dest)!.push({ ...link, from });
			}
		}
	}

	/** The node id a link points to, if it points into the vault. */
	resolve(link: Pick<RoamLink, 'type' | 'dest'>): string | null {
		if (link.type === 'id') return this.nodes.has(link.dest) ? link.dest : null;
		if (link.type === 'roam') return this.titles.get(link.dest.toLowerCase()) ?? null;
		return null;
	}

	node(id: string): RoamNode | undefined {
		return this.nodes.get(id);
	}

	file(path: string): VaultFile | undefined {
		return this.files.get(path);
	}

	/** Links leaving a node (resolved within the vault), excluding those in child nodes. */
	forwardLinks(id: string): { link: RoamLink; node: RoamNode }[] {
		const node = this.nodes.get(id);
		if (!node) return [];
		const out: { link: RoamLink; node: RoamNode }[] = [];
		const seen = new Set<string>();
		for (const link of this.files.get(node.file)?.index.links ?? []) {
			if (link.source !== id) continue;
			const dest = this.resolve(link);
			const target = dest ? this.nodes.get(dest) : undefined;
			if (target && !seen.has(target.id)) {
				seen.add(target.id);
				out.push({ link, node: target });
			}
		}
		return out;
	}

	/** Backlinks grouped by the node they come from. */
	backlinksOf(id: string): { from: RoamNode; links: Backlink[] }[] {
		const groups = new Map<string, { from: RoamNode; links: Backlink[] }>();
		for (const link of this.backlinks.get(id) ?? []) {
			const group = groups.get(link.from.id) ?? { from: link.from, links: [] };
			group.links.push(link);
			groups.set(link.from.id, group);
		}
		return [...groups.values()];
	}

	/** The file-level node of a file, or its first node. */
	fileNode(path: string): RoamNode | undefined {
		const nodes = this.files.get(path)?.index.nodes ?? [];
		return nodes.find((n) => n.level === 0) ?? nodes[0];
	}

	/** Every headline carrying a TODO keyword or planning date. */
	agenda(): AgendaItem[] {
		const items: AgendaItem[] = [];
		for (const file of this.files.values()) {
			if (file.index.excluded) continue;
			for (const h of file.index.headlines) {
				if (!h.todo && !h.scheduled && !h.deadline) continue;
				items.push({
					...h,
					file: file.path,
					node: (h.ownerId && this.nodes.get(h.ownerId)) || null,
				});
			}
		}
		return items;
	}

	/** `true` when a keyword is one of the file's (or the vault's) done states. */
	isDone(keyword: string | null, file?: string): boolean {
		if (!keyword) return false;
		const config = (file && this.files.get(file)?.index.keywords) || this.keywords;
		return config.doneKeywords.includes(keyword);
	}
}
