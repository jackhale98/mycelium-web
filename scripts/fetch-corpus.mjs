// Fetch the real-world org corpus used by tests/corpus at pinned commits.
// The files keep their own licences (GPL/GFDL for org-mode and org-roam), so
// they are downloaded for testing rather than vendored into this repository.
//
//   node scripts/fetch-corpus.mjs   →  tests/corpus/.cache/<source>/...
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SOURCES = [
	{
		name: 'org-mode',
		repo: 'https://github.com/emacs-straight/org-mode',
		commit: 'f38ac21c28f93da1fed1cb4bb46ec3006636f809',
		paths: ['doc/org-manual.org', 'etc/ORG-NEWS', 'testing/examples'],
	},
	{
		name: 'org-roam',
		repo: 'https://github.com/org-roam/org-roam',
		commit: '903bd4ec56d29247990d005ed9052c201e18b812',
		paths: ['tests/roam-files'],
	},
	{
		// Jethro Kuan's published org-roam vault: hundreds of real notes.
		name: 'braindump',
		repo: 'https://github.com/jethrokuan/braindump',
		commit: 'df28c5c0856df6203580e763afd4dbde2c2c8279',
		paths: ['org'],
	},
];

const out = join(process.cwd(), 'tests/corpus/.cache');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });

function copyOrg(from, to) {
	if (statSync(from).isDirectory()) {
		for (const name of readdirSync(from)) copyOrg(join(from, name), join(to, name));
	} else if (from.endsWith('.org') || from.endsWith('ORG-NEWS')) {
		mkdirSync(dirname(to), { recursive: true });
		cpSync(from, to);
	}
}

for (const source of SOURCES) {
	const target = join(out, source.name);
	const stamp = join(target, `.${source.commit}`);
	if (existsSync(stamp)) {
		console.log(`${source.name}: cached`);
		continue;
	}
	rmSync(target, { recursive: true, force: true });
	const work = mkdtempSync(join(tmpdir(), 'corpus-'));
	git(work, 'init', '-q');
	git(work, 'remote', 'add', 'origin', source.repo);
	git(work, 'sparse-checkout', 'set', '--no-cone', ...source.paths);
	git(work, 'fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', source.commit);
	git(work, 'checkout', '-q', 'FETCH_HEAD');
	for (const path of source.paths) copyOrg(join(work, path), join(target, path.split('/').pop()));
	mkdirSync(target, { recursive: true });
	cpSync(join(work, '.git', 'HEAD'), stamp);
	rmSync(work, { recursive: true, force: true });
	console.log(`${source.name}: fetched ${source.commit.slice(0, 7)}`);
}
