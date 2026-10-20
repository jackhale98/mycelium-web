/// Property drawers, for headlines and for the file itself.
///
/// ```org
/// :PROPERTIES:
/// :ID:       6f1c…
/// :ROAM_ALIASES: "Rust lang"
/// :END:
/// ```
///
/// A headline's drawer must directly follow the headline (or its planning
/// line); a file's drawer must come before any other content, preceded at most
/// by blank lines and comments. Anything else is just text to org.

import { headlineAt, type HeadlineScan } from './headline';
import { findPlanning } from './planning';
import { splitLines, type Change, type Line } from './text';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig, type Span } from './types';

const DRAWER_START_RE = /^[ \t]*:PROPERTIES:[ \t]*$/i;
const DRAWER_END_RE = /^[ \t]*:END:[ \t]*$/i;
const PROPERTY_RE = /^([ \t]*):([^\s:]+):(?:([ \t]+)(.*?))?[ \t]*$/;

export interface Property {
	/** Key as written (case preserved). */
	key: string;
	value: string;
	line: Line;
	/** Span of the value; zero-width at the line end when the value is empty. */
	valueSpan: Span;
}

export interface PropertyDrawer {
	start: Line;
	end: Line;
	properties: Property[];
}

/** `null` targets the file-level drawer; otherwise the offset of a headline. */
export type PropertyOwner = number | null;

function readDrawer(lines: readonly Line[], startIndex: number): PropertyDrawer | null {
	const start = lines[startIndex];
	if (!start || !DRAWER_START_RE.test(start.text)) return null;
	const properties: Property[] = [];
	for (let i = startIndex + 1; i < lines.length; i += 1) {
		const line = lines[i]!;
		if (DRAWER_END_RE.test(line.text)) return { start, end: line, properties };
		if (/^\*+[ \t]/.test(line.text)) return null;
		const m = PROPERTY_RE.exec(line.text);
		if (!m) continue;
		const valueText = m[4] ?? '';
		const valueFrom =
			m[3] !== undefined ? line.from + m[1]!.length + m[2]!.length + 2 + m[3].length : line.to;
		properties.push({
			key: m[2]!,
			value: valueText,
			line,
			valueSpan: { from: valueFrom, to: valueFrom + valueText.length },
		});
	}
	return null;
}

/** Index of the line where a file-level drawer may start. */
function fileDrawerIndex(lines: readonly Line[]): number {
	let i = 0;
	while (
		i < lines.length &&
		(lines[i]!.text.trim() === '' || /^[ \t]*#(?:[ \t]|$)/.test(lines[i]!.text))
	)
		i += 1;
	return i;
}

/** Index of the line where a headline's drawer may start. */
function headlineDrawerIndex(lines: readonly Line[], headline: HeadlineScan): number {
	const planning = findPlanning(lines, headline);
	return headline.line.index + (planning ? 2 : 1);
}

export function findPropertyDrawer(
	source: string,
	owner: PropertyOwner,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
	lines: readonly Line[] = splitLines(source),
): PropertyDrawer | null {
	if (owner === null) return readDrawer(lines, fileDrawerIndex(lines));
	const h = headlineAt(source, owner, config, lines);
	return h ? readDrawer(lines, headlineDrawerIndex(lines, h)) : null;
}

export function getProperties(
	source: string,
	owner: PropertyOwner,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const p of findPropertyDrawer(source, owner, config)?.properties ?? []) {
		const key = p.key.toUpperCase();
		if (key.endsWith('+')) {
			const base = key.slice(0, -1);
			result[base] = result[base] ? `${result[base]} ${p.value}` : p.value;
		} else if (!(key in result)) {
			result[key] = p.value;
		}
	}
	return result;
}

export function getProperty(
	source: string,
	owner: PropertyOwner,
	key: string,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): string | null {
	return getProperties(source, owner, config)[key.toUpperCase()] ?? null;
}

/**
 * Format a property line, following the drawer's existing value column when
 * its properties are aligned, otherwise org's `org-property-format` (`%-10s %s`).
 */
function formatProperty(drawer: PropertyDrawer | null, key: string, value: string): string {
	const indent = drawer ? /^[ \t]*/.exec(drawer.start.text)![0] : '';
	const label = `:${key}:`;
	let column: number | null = null;
	const props = drawer?.properties ?? [];
	if (props.length > 0) {
		const columns = props.map((p) => p.valueSpan.from - p.line.from - indent.length);
		const aligned = props.length > 1 && columns.every((c) => c === columns[0]);
		const single =
			props.length === 1 &&
			props[0]!.valueSpan.from - props[0]!.line.from - indent.length >
				`:${props[0]!.key}:`.length + 1;
		if (aligned || single) column = columns[0]!;
		else column = -1; // unaligned drawer: one space
	}
	if (column === -1) return `${indent}${label} ${value}`.trimEnd();
	const width = column ?? 11;
	const pad = Math.max(1, width - label.length);
	return `${indent}${label}${' '.repeat(pad)}${value}`.trimEnd();
}

/**
 * Set (or with `null` remove) a property. Creates the drawer when missing:
 * after the headline and its planning line, or at the top of the file.
 */
export function setProperty(
	source: string,
	owner: PropertyOwner,
	key: string,
	value: string | null,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] {
	const lines = splitLines(source);
	const drawer = findPropertyDrawer(source, owner, config, lines);
	const eol = source.includes('\r\n') ? '\r\n' : '\n';
	const clean = value === null ? null : value.replace(/[\r\n]+/g, ' ').trim();
	const existing = drawer?.properties.find((p) => p.key.toUpperCase() === key.toUpperCase());

	if (existing) {
		if (clean === null) return [{ from: existing.line.from, to: existing.line.end, insert: '' }];
		if (existing.value === clean) return [];
		if (existing.valueSpan.from === existing.line.to) {
			return [{ from: existing.line.to, to: existing.line.to, insert: ` ${clean}` }];
		}
		return [{ from: existing.valueSpan.from, to: existing.valueSpan.to, insert: clean }];
	}
	if (clean === null) return [];

	if (drawer) {
		const line = formatProperty(drawer, key, clean);
		return [
			{ from: drawer.end.from, to: drawer.end.from, insert: `${line}${drawer.end.eol || eol}` },
		];
	}

	const block = [':PROPERTIES:', formatProperty(null, key, clean), ':END:'];
	if (owner === null) {
		const at = lines[fileDrawerIndex(lines)]?.from ?? source.length;
		const needsLead = at === source.length && source.length > 0 && !source.endsWith('\n');
		return [{ from: at, to: at, insert: `${needsLead ? eol : ''}${block.join(eol)}${eol}` }];
	}
	const h = headlineAt(source, owner, config, lines);
	if (!h) return [];
	const planning = findPlanning(lines, h);
	const anchor = planning ? planning.line : h.line;
	const indent = planning ? /^[ \t]*/.exec(planning.line.text)![0] : '';
	const text = block.map((l) => `${indent}${l}`).join(eol);
	return anchor.eol
		? [{ from: anchor.end, to: anchor.end, insert: `${text}${eol}` }]
		: [{ from: anchor.end, to: anchor.end, insert: `${eol}${text}` }];
}

/** Values of a multi-value property such as `ROAM_ALIASES`: `"Foo bar" baz` → `['Foo bar', 'baz']`. */
export function splitPropertyValues(value: string | null | undefined): string[] {
	if (!value) return [];
	const out: string[] = [];
	const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
	for (let m = re.exec(value); m; m = re.exec(value)) {
		const v = m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]!;
		if (v.length > 0) out.push(v);
	}
	return out;
}

/** Inverse of {@link splitPropertyValues}: quote values that contain whitespace. */
export function joinPropertyValues(values: readonly string[]): string {
	return values.map((v) => (/[\s"]/.test(v) ? `"${v.replace(/(["\\])/g, '\\$1')}"` : v)).join(' ');
}
