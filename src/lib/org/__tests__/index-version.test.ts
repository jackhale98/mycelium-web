// Browsers keep each note's index between visits, keyed by INDEX_VERSION.
// This pins what scanFile produces for the test fixtures: when it changes,
// cached indexes are out of date, so bump INDEX_VERSION (which re-indexes
// everyone's notes once) and record the new fingerprint here. (A fixture
// edited on purpose needs only the new fingerprint.)

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INDEX_VERSION, scanFile } from '..';

const FINGERPRINT = {
	version: 1,
	sha256: '2a4280c91c7f1af3ce227c0b37bf3996daca016a4f0f56b77f6c3abcc714f194',
};

function orgFiles(dir: string): string[] {
	return (readdirSync(dir, { recursive: true }) as string[])
		.filter((f) => f.endsWith('.org'))
		.sort()
		.map((f) => join(dir, f));
}

describe('the cached index format', () => {
	it('changes only with INDEX_VERSION', () => {
		const hash = createHash('sha256');
		for (const path of orgFiles(join(process.cwd(), 'tests/fixtures'))) {
			const rel = path.slice(process.cwd().length + 1);
			hash.update(rel);
			hash.update(JSON.stringify(scanFile(rel, readFileSync(path, 'utf8'))));
		}
		const now = { version: INDEX_VERSION, sha256: hash.digest('hex') };
		expect(
			now,
			'What scanFile produces has changed: bump INDEX_VERSION in scan.ts and record the new fingerprint.',
		).toEqual(FINGERPRINT);
	});
});
