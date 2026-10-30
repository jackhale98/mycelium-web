// Browsers keep each note's index between visits, keyed by INDEX_VERSION.
// This pins what scanFile produces for the fixtures and the demo vault: when
// it changes, cached indexes are out of date, so bump INDEX_VERSION (which
// re-indexes everyone's notes once) and record the new fingerprint here.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INDEX_VERSION, scanFile } from '..';

const FINGERPRINT = {
	version: 1,
	sha256: 'bba6f2e295e16d1166852ef5ceb33c40e4663788b7dd234105edd882f97daaa1',
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
		for (const path of [
			...orgFiles(join(process.cwd(), 'tests/fixtures')),
			...orgFiles(join(process.cwd(), 'src/demo/vault')),
		]) {
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
