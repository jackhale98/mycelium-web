import { describe, expect, it } from 'vitest';
import { parseRepo } from './providers';

describe('parseRepo', () => {
	it('accepts shorthand, web and clone URLs', () => {
		expect(parseRepo('jack/notes', 'github')).toEqual({
			provider: 'github',
			url: 'https://github.com/jack/notes.git',
			slug: 'jack/notes',
		});
		expect(parseRepo('https://github.com/jack/notes/tree/main/daily', 'github')?.url).toBe(
			'https://github.com/jack/notes.git',
		);
		expect(parseRepo('https://gitlab.com/group/sub/notes.git', 'github')).toEqual({
			provider: 'gitlab',
			url: 'https://gitlab.com/group/sub/notes.git',
			slug: 'group/sub/notes',
		});
		expect(parseRepo('git@bitbucket.org:team/notes.git', 'other')?.provider).toBe('bitbucket');
		expect(parseRepo('https://git.example.com/me/notes', 'other')?.url).toBe(
			'https://git.example.com/me/notes.git',
		);
	});

	it('rejects non-HTTPS and incomplete input', () => {
		expect(parseRepo('http://github.com/a/b', 'github')).toBeNull();
		expect(parseRepo('http://localhost:8080/me/notes', 'other')?.url).toBe(
			'http://localhost:8080/me/notes.git',
		);
		expect(parseRepo('notes', 'github')).toBeNull();
		expect(parseRepo('', 'github')).toBeNull();
	});
});
