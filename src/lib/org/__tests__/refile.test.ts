import { describe, expect, it } from 'vitest';
import { applyChanges } from '../text';
import {
	archiveLocation,
	archiveSubtree,
	deleteSubtree,
	refileAcross,
	refileWithin,
	shiftLevels,
} from '../refile';

const now = { date: '2020-07-05', time: '00:00' };

describe('refile', () => {
	it('test-org/refile: the tree becomes the last child, one level down', () => {
		const src = '* H1\n* H2';
		expect(applyChanges(src, refileWithin(src, 5, 0)!)).toBe('* H1\n** H2\n');
	});

	it('keeps relative levels, lands after existing children, and refuses its own subtree', () => {
		const src = '* Target\n** Old child\n* Move\n** Kid\nText\n* Other\n';
		expect(applyChanges(src, refileWithin(src, src.indexOf('* Move'), 0)!)).toBe(
			'* Target\n** Old child\n** Move\n*** Kid\nText\n* Other\n',
		);
		expect(refileWithin(src, src.indexOf('* Move'), src.indexOf('** Kid'))).toBeNull();
	});

	it('refiles to the end of another file, at the top level or under a heading', () => {
		const r = refileAcross('* A\n** B\nbody\n* C\n', 4, '* Inbox\n', null)!;
		expect(applyChanges('* A\n** B\nbody\n* C\n', r.source)).toBe('* A\n* C\n');
		expect(applyChanges('* Inbox\n', r.target)).toBe('* Inbox\n* B\nbody\n');
		const r2 = refileAcross('* B\n', 0, '* T\n* U', 0)!;
		expect(applyChanges('* T\n* U', r2.target)).toBe('* T\n** B\n* U');
	});

	it('shifts headings but not stars inside blocks', () => {
		expect(shiftLevels('** a\n#+begin_example\n* not a heading\n#+end_example\n*** b\n', -1)).toBe(
			'* a\n#+begin_example\n* not a heading\n#+end_example\n** b\n',
		);
	});
});

describe('archive', () => {
	const ctx = (file = 'notes.org') => ({
		now,
		file,
		category: 'notes',
		inheritedTags: [] as string[],
	});

	it('finds the location: property (inherited), #+ARCHIVE, then the default', () => {
		expect(archiveLocation('* a\n', 0, 'dir/notes.org')).toEqual({
			file: 'dir/notes.org_archive',
			heading: null,
		});
		expect(archiveLocation('#+ARCHIVE: ::* Archived Tasks\n* a\n', 30, 'notes.org')).toEqual({
			file: null,
			heading: '* Archived Tasks',
		});
		const prop = '* P\n:PROPERTIES:\n:ARCHIVE: done/%s::* From %s\n:END:\n** a\n';
		expect(archiveLocation(prop, prop.indexOf('** a'), 'x/notes.org')).toEqual({
			file: 'x/done/notes.org',
			heading: '* From notes.org',
		});
	});

	it('test-org-archive/context: same-file heading location', () => {
		const src = '#+ARCHIVE: ::* Archived Tasks\n* a\n** TODO b\n';
		const r = archiveSubtree(src, src.indexOf('** TODO b'), 'notes.org', ctx(), null)!;
		expect(applyChanges(src, r.source).trim()).toBe(`#+ARCHIVE: ::* Archived Tasks
* a
* Archived Tasks

** TODO b
:PROPERTIES:
:ARCHIVE_TIME: 2020-07-05 Sun 00:00
:ARCHIVE_FILE: notes.org
:ARCHIVE_OLPATH: a
:ARCHIVE_CATEGORY: notes
:ARCHIVE_TODO: TODO
:END:`);
	});

	it('test-org-archive/context: a top-level tree keeps its children, no OLPATH or TODO', () => {
		const src = '#+ARCHIVE: ::* Archived Tasks\n* a\n** b';
		const r = archiveSubtree(src, src.indexOf('* a'), 'notes.org', ctx(), null)!;
		expect(applyChanges(src, r.source).trim()).toBe(`#+ARCHIVE: ::* Archived Tasks
* Archived Tasks

** a
:PROPERTIES:
:ARCHIVE_TIME: 2020-07-05 Sun 00:00
:ARCHIVE_FILE: notes.org
:ARCHIVE_CATEGORY: notes
:END:
*** b`);
	});

	it('appends under an existing archive heading above the tree, one blank line apart', () => {
		const src = '#+ARCHIVE: ::* Archived Tasks\n* Archived Tasks\n\n** old\n* a\n* b\n';
		const r = archiveSubtree(src, src.indexOf('* a'), 'notes.org', ctx(), null)!;
		expect(applyChanges(src, r.source)).toBe(
			'#+ARCHIVE: ::* Archived Tasks\n* Archived Tasks\n\n** old\n\n** a\n:PROPERTIES:\n:ARCHIVE_TIME: 2020-07-05 Sun 00:00\n:ARCHIVE_FILE: notes.org\n:ARCHIVE_CATEGORY: notes\n:END:\n* b\n',
		);
	});

	it('adds inherited tags in the same file (itags test)', () => {
		const src = '#+ARCHIVE: ::* Archived Tasks\n* a  :top:\n** b  :b_tag:\n';
		const r = archiveSubtree(
			src,
			src.indexOf('** b'),
			'notes.org',
			{ ...ctx(), inheritedTags: ['top'] },
			null,
		)!;
		const out = applyChanges(src, r.source);
		expect(out).toMatch(/\*\* b +:top:b_tag:\n:PROPERTIES:\n/);
		expect(out).toContain(':ARCHIVE_ITAGS: top\n');
	});

	// ARCHIVE_OLPATH keeps headings as written, cookies included (org-get-outline-path).
	it('creates the archive file with its header, then appends with a blank line', () => {
		const src = '* Parent [/]\n** DONE x\n** TODO y\n';
		const r = archiveSubtree(src, src.indexOf('** DONE'), 'p/notes.org', ctx('p/notes.org'), null)!;
		expect(r.archivePath).toBe('p/notes.org_archive');
		expect(r.archiveText).toBe(
			'\nArchived entries from file p/notes.org\n\n\n** DONE x\n:PROPERTIES:\n:ARCHIVE_TIME: 2020-07-05 Sun 00:00\n:ARCHIVE_FILE: p/notes.org\n:ARCHIVE_OLPATH: Parent [/]\n:ARCHIVE_CATEGORY: notes\n:ARCHIVE_TODO: DONE\n:END:\n',
		);
		// The parent's cookie is recounted after the cut (test-org-archive/update-status-cookie).
		expect(applyChanges(src, r.source)).toBe('* Parent [0/1]\n** TODO y\n');
		const again = archiveSubtree('* z\n', 0, 'p/notes.org', ctx('p/notes.org'), r.archiveText)!;
		expect(again.archiveText!.startsWith(r.archiveText! + '\n* z\n')).toBe(true);
	});
});

describe('deleteSubtree', () => {
	it('removes a heading with everything under it, and nothing else', () => {
		const src = '#+title: Inbox\n\n* TODO a\nbody\n** sub\n\n* TODO b\n';
		expect(applyChanges(src, deleteSubtree(src, src.indexOf('* TODO a')))).toBe(
			'#+title: Inbox\n\n* TODO b\n',
		);
		expect(applyChanges(src, deleteSubtree(src, src.indexOf('* TODO b')))).toBe(
			'#+title: Inbox\n\n* TODO a\nbody\n** sub\n\n',
		);
	});
});
