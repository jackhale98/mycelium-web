import { describe, expect, it } from 'vitest';
import { texOf } from './math';

describe('texOf', () => {
	it('takes the maths out of each kind of delimiter', () => {
		expect(texOf('$x^2$')).toEqual({ tex: 'x^2', display: false });
		expect(texOf('$$\\sum_i x_i$$')).toEqual({ tex: '\\sum_i x_i', display: true });
		expect(texOf('\\(a+b\\)')).toEqual({ tex: 'a+b', display: false });
		expect(texOf('\\[E=mc^2\\]')).toEqual({ tex: 'E=mc^2', display: true });
		const env = '\\begin{equation}\nx=1\n\\end{equation}';
		expect(texOf(env)).toEqual({ tex: env, display: true });
	});

	it('leaves LaTeX commands that are not maths alone', () => {
		expect(texOf('\\enlargethispage{2cm}')).toBeNull();
		expect(texOf('\\alpha')).toBeNull();
	});
});
