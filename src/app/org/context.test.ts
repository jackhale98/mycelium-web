import { describe, expect, it } from 'vitest';
import { imageAttrs } from './context';

describe('imageAttrs', () => {
	it('reads widths the way org-display-inline-image--width does', () => {
		expect(imageAttrs({ ATTR_ORG: [':width 300'] }).width).toBe('300px');
		expect(imageAttrs({ ATTR_ORG: [':width 300px'] }).width).toBe('300px');
		expect(imageAttrs({ ATTR_HTML: [':width 50%'] }).width).toBe('50%');
		expect(imageAttrs({ ATTR_LATEX: [':width 0.5\\textwidth'] }).width).toBe('50%');
		expect(imageAttrs({ ATTR_ORG: [':width t'] }).width).toBeNull();
		expect(imageAttrs({ ATTR_HTML: [':width 4in'] }).width).toBeNull();
		expect(imageAttrs(undefined)).toEqual({ width: null, align: null });
	});

	it('prefers #+ATTR_ORG and reads alignment', () => {
		const a = imageAttrs({ ATTR_HTML: [':width 50%'], ATTR_ORG: [':width 200 :align right'] });
		expect(a).toEqual({ width: '200px', align: 'right' });
		expect(imageAttrs({ ATTR_ORG: [':center t'] }).align).toBe('center');
	});
});
