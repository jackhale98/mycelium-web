import { describe, expect, it } from 'vitest';
import { imageLink, imagePath, relativeTo } from './images';

const when = new Date(2026, 9, 21, 14, 32, 5);

describe('picture files', () => {
	it('names them by date, keeping a meaningful original name', () => {
		expect(imagePath('images', 'Garden Plan (v2).PNG', 'png', when)).toBe(
			'images/2026-10-21-143205-garden-plan-v2.png',
		);
		expect(imagePath('images', 'IMG_4821.HEIC', 'jpg', when)).toBe('images/2026-10-21-143205.jpg');
		expect(imagePath('/assets/pics/', 'Café.jpg', 'jpg', when)).toBe(
			'assets/pics/2026-10-21-143205-cafe.jpg',
		);
		expect(imagePath('', 'x.jpg', 'jpg', when)).toBe('2026-10-21-143205-x.jpg');
	});
	it('links relative to the note', () => {
		expect(relativeTo('notes/garden.org', 'images/a.jpg')).toBe('../images/a.jpg');
		expect(relativeTo('garden.org', 'images/a.jpg')).toBe('images/a.jpg');
		expect(relativeTo('daily/2026/x.org', 'images/a.jpg')).toBe('../../images/a.jpg');
		expect(relativeTo('images/notes.org', 'images/a.jpg')).toBe('a.jpg');
		expect(imageLink('garden.org', 'images/a.jpg')).toBe('[[file:images/a.jpg]]');
		expect(imageLink('daily/x.org', 'images/a.jpg')).toBe('[[file:../images/a.jpg]]');
	});
});
