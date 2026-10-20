/// org-roam extraction: nodes, links, tags, aliases, refs and every headline
/// (for the agenda), from one file. Mirrors what org-roam's database records.

import type { Headline, Keyword, OrgNode, Planning, PropertyDrawer, Section } from 'uniorg';
import { parseTagList } from './keywords';
import { effectiveKeywords, endOf, parseOrg, plainText, startOf } from './parse';
import { splitPropertyValues } from './properties';
import { parseTimestamp } from './timestamp';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig, type OrgTimestamp } from './types';

export interface RoamRef {
	ref: string;
	type: string;
}

export interface RoamNode {
	id: string;
	file: string;
	/** 0 for a file node, otherwise the headline level. */
	level: number;
	/** Offset of the headline (0 for a file node). */
	pos: number;
	title: string;
	/** Outline path: titles of ancestor headlines. */
	olp: string[];
	tags: string[];
	aliases: string[];
	refs: RoamRef[];
	todo: string | null;
	priority: string | null;
	scheduled: OrgTimestamp | null;
	deadline: OrgTimestamp | null;
	properties: Record<string, string>;
}

export interface RoamLink {
	/** Node id the link sits in. */
	source: string;
	/** Link path: a node id for `id:` links, the target otherwise. */
	dest: string;
	type: string;
	pos: number;
	end: number;
	description: string | null;
	/** Raw org text of the enclosing paragraph, list item or headline. */
	context: string;
}

export interface HeadlineEntry {
	pos: number;
	level: number;
	title: string;
	todo: string | null;
	priority: string | null;
	/** Own tags plus inherited ones (file tags and ancestors). */
	tags: string[];
	scheduled: OrgTimestamp | null;
	deadline: OrgTimestamp | null;
	closed: OrgTimestamp | null;
	/** The headline's own `:ID:`, when it is a node. */
	id: string | null;
	/** The innermost node containing the headline (itself, an ancestor, or the file). */
	ownerId: string | null;
	olp: string[];
}

export interface FileIndex {
	path: string;
	title: string;
	/** `#+ROAM_EXCLUDE` / file-level `ROAM_EXCLUDE: t`. */
	excluded: boolean;
	filetags: string[];
	keywords: KeywordConfig;
	nodes: RoamNode[];
	links: RoamLink[];
	headlines: HeadlineEntry[];
	/** Plain body text for full-text search. */
	text: string;
}

const truthy = (v: string | undefined) => v !== undefined && v.trim() !== '' && v.trim().toLowerCase() !== 'nil';

function drawerProperties(drawer: PropertyDrawer | undefined): Record<string, string> {
	const props: Record<string, string> = {};
	for (const p of drawer?.children ?? []) {
		const key = p.key.toUpperCase();
		if (key.endsWith('+')) {
			const base = key.slice(0, -1);
			props[base] = props[base] ? `${props[base]} ${p.value}` : p.value;
		} else if (!(key in props)) {
			props[key] = p.value;
		}
	}
	return props;
}

/** `ROAM_REFS` values: `cite:key`, `@key`, `[cite:@key]` and URLs. */
export function parseRefs(value: string | undefined): RoamRef[] {
	const refs: RoamRef[] = [];
	for (const raw of splitPropertyValues(value)) {
		const v = raw.replace(/^\[\[(.*)\]\]$/, '$1').replace(/^\[cite:(.*)\]$/, '$1');
		const cite = /^(?:cite:)?@?([^\s;]+)$/.exec(v);
		const url = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(v);
		if (url && url[1]!.toLowerCase() !== 'cite') refs.push({ ref: url[2]!, type: url[1]!.toLowerCase() });
		else if (cite) refs.push({ ref: cite[1]!, type: 'cite' });
	}
	return refs;
}

function basename(path: string): string {
	const file = path.split('/').pop() ?? path;
	return file.replace(/\.org$/i, '');
}

const CONTEXT_TYPES = new Set(['paragraph', 'headline', 'list-item', 'table-row', 'quote-block']);
const MAX_CONTEXT = 400;

/** Index one org file. `path` is repo-relative. */
export function indexFile(
	path: string,
	source: string,
	globalKeywords: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): FileIndex {
	const keywords = effectiveKeywords(source, globalKeywords);
	const tree = parseOrg(source, keywords);

	const fileKeywords = new Map<string, string>();
	let fileDrawer: PropertyDrawer | undefined;
	for (const child of tree.children) {
		if (child.type === 'property-drawer' && !fileDrawer && fileKeywords.size === 0) fileDrawer = child;
		if (child.type === 'keyword') {
			const k = child as Keyword;
			if (!fileKeywords.has(k.key.toUpperCase())) fileKeywords.set(k.key.toUpperCase(), k.value);
		}
		if (child.type === 'section') break;
	}
	// org collects in-buffer keywords from the whole file, not just the preamble.
	walk(tree, (n) => {
		if (n.type === 'keyword' && !fileKeywords.has(n.key.toUpperCase())) fileKeywords.set(n.key.toUpperCase(), n.value);
	});

	const fileProps = drawerProperties(fileDrawer);
	const filetags = parseTagList(fileKeywords.get('FILETAGS'));
	const title = fileKeywords.get('TITLE')?.trim() || basename(path);
	const excluded = truthy(fileProps['ROAM_EXCLUDE']) || truthy(fileKeywords.get('ROAM_EXCLUDE'));

	const nodes: RoamNode[] = [];
	const links: RoamLink[] = [];
	const headlines: HeadlineEntry[] = [];
	const text: string[] = [title];

	const fileId = !excluded && fileProps['ID'] ? fileProps['ID'].trim() : null;
	if (fileId) {
		nodes.push({
			id: fileId,
			file: path,
			level: 0,
			pos: 0,
			title,
			olp: [],
			tags: filetags,
			aliases: splitPropertyValues(fileProps['ROAM_ALIASES']),
			refs: parseRefs(fileProps['ROAM_REFS']),
			todo: null,
			priority: null,
			scheduled: null,
			deadline: null,
			properties: fileProps,
		});
	}

	interface Frame {
		olp: string[];
		tags: string[];
		ownerId: string | null;
	}

	const visitSection = (section: Section, parent: Frame) => {
		const headline = section.children.find((c) => c.type === 'headline') as Headline | undefined;
		if (!headline) return;
		const idx = section.children.indexOf(headline);
		let next = section.children[idx + 1];
		let planning: Planning | undefined;
		if (next?.type === 'planning') {
			planning = next;
			next = section.children[idx + 2];
		}
		const drawer = next?.type === 'property-drawer' ? next : undefined;
		const props = drawerProperties(drawer);
		const htitle = plainText(headline.children).trim();
		const tags = [...new Set([...parent.tags, ...headline.tags])];
		const id = !excluded && props['ID'] && !truthy(props['ROAM_EXCLUDE']) ? props['ID'].trim() : null;
		const ts = (t: { rawValue: string } | null | undefined) => (t ? parseTimestamp(t.rawValue) : null);
		const pos = startOf(headline);

		if (id) {
			nodes.push({
				id,
				file: path,
				level: headline.level,
				pos,
				title: htitle,
				olp: parent.olp,
				tags,
				aliases: splitPropertyValues(props['ROAM_ALIASES']),
				refs: parseRefs(props['ROAM_REFS']),
				todo: headline.todoKeyword,
				priority: headline.priority,
				scheduled: ts(planning?.scheduled),
				deadline: ts(planning?.deadline),
				properties: props,
			});
		}
		headlines.push({
			pos,
			level: headline.level,
			title: htitle,
			todo: headline.todoKeyword,
			priority: headline.priority,
			tags,
			scheduled: ts(planning?.scheduled),
			deadline: ts(planning?.deadline),
			closed: ts(planning?.closed),
			id,
			ownerId: id ?? parent.ownerId,
			olp: parent.olp,
		});
		text.push(htitle);
		const frame: Frame = { olp: [...parent.olp, htitle], tags, ownerId: id ?? parent.ownerId };
		// Links in a headline's title belong to the headline's own node.
		collect(headline, frame, headline);
		collect(section, frame);
	};

	const collect = (node: OrgNode, frame: Frame, context?: OrgNode) => {
		if (!('children' in node) || !Array.isArray(node.children)) return;
		for (const child of node.children as OrgNode[]) {
			if (child.type === 'section') {
				visitSection(child, frame);
				continue;
			}
			if (child.type === 'property-drawer' || child.type === 'keyword' || child.type === 'planning') continue;
			if (child.type === 'link' && frame.ownerId) {
				const ctx = context ?? child;
				let raw = source.slice(startOf(ctx), endOf(ctx)).trim();
				if (raw.length > MAX_CONTEXT) raw = `${raw.slice(0, MAX_CONTEXT)}…`;
				links.push({
					source: frame.ownerId,
					dest: child.path,
					type: child.linkType,
					pos: startOf(child),
					end: endOf(child),
					description: child.children.length > 0 ? plainText(child.children) : null,
					context: raw,
				});
			}
			if (child.type === 'citation-reference' && frame.ownerId) {
				const key = (child.children.find((c) => c.type === 'citation-key') as { key?: string } | undefined)?.key;
				if (key) {
					links.push({
						source: frame.ownerId,
						dest: key,
						type: 'cite',
						pos: startOf(child),
						end: endOf(child),
						description: null,
						context: context ? source.slice(startOf(context), endOf(context)).trim().slice(0, MAX_CONTEXT) : '',
					});
				}
			}
			if (child.type === 'paragraph' || child.type === 'table-row') text.push(plainText(child));
			if (child.type === 'src-block' || child.type === 'example-block') text.push(child.value);
			if (child.type === 'headline') continue;
			collect(child, frame, CONTEXT_TYPES.has(child.type) ? child : context);
		}
	};

	const root: Frame = { olp: [], tags: filetags, ownerId: fileId };
	collect(tree, root);

	return { path, title, excluded, filetags, keywords, nodes, links, headlines, text: text.join('\n') };
}

function walk(node: OrgNode, visit: (n: OrgNode) => void) {
	visit(node);
	if ('children' in node && Array.isArray(node.children)) for (const c of node.children as OrgNode[]) walk(c, visit);
}
