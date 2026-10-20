import { describe, expect, it } from 'vitest';
import { dailyDate, dailyPath, detectLayout, inVault } from './layout';

describe('layout', () => {
	it('finds the roam directory and dailies', () => {
		const layout = detectLayout([
			{ path: 'README.org', hasId: false },
			{ path: 'notes/a.org', hasId: true },
			{ path: 'notes/b/c.org', hasId: true },
			{ path: 'notes/journal/20240101.org', hasId: true },
			{ path: 'notes/journal/20240102.org', hasId: true },
		]);
		expect(layout).toEqual({ roamDir: 'notes', dailyDir: 'journal', dailyFormat: 'YYYYMMDD' });
		expect(dailyPath(layout, '2026-10-20')).toBe('notes/journal/20261020.org');
		expect(dailyDate(layout, 'notes/journal/20261020.org')).toBe('2026-10-20');
		expect(inVault(layout, 'README.org')).toBe(false);
		// org-attach directories (org-roam-file-exclude-regexp = "data/").
		expect(inVault(layout, 'notes/data/ab/cdef/attached.org')).toBe(false);
		expect(inVault(layout, 'notes/b/c.org')).toBe(true);
	});

	it('defaults to org-roam conventions', () => {
		const layout = detectLayout([{ path: 'a.org', hasId: true }]);
		expect(layout).toEqual({ roamDir: '', dailyDir: 'daily', dailyFormat: 'YYYY-MM-DD' });
		expect(dailyPath(layout, '2026-10-20')).toBe('daily/2026-10-20.org');
	});
});
