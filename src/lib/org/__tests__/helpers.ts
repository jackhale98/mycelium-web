import { applyChanges, type Change } from '../text';

/** Apply changes and return the new text. */
export const apply = (source: string, changes: Change[]) => applyChanges(source, changes);

/** Offset of the first occurrence of `needle` in `source`. */
export const at = (source: string, needle: string) => {
	const i = source.indexOf(needle);
	if (i === -1) throw new Error(`"${needle}" not found`);
	return i;
};
