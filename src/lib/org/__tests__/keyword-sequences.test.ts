import { describe, expect, it } from 'vitest';
import {
	configToSequences,
	fileTodoKeywords,
	formatTodoLine,
	parseTodoLine,
	sequencesToConfig,
} from '../keywords';

describe('keyword sequences', () => {
	it('round-trips #+TODO lines with keys and logging', () => {
		for (const line of [
			'TODO(t) NEXT(n) WAIT(w@/!) | DONE(d!) CANCELLED(c@)',
			'TODO | DONE',
			'BACKLOG TODO DOING REVIEW | DONE',
		])
			expect(formatTodoLine(parseTodoLine(line))).toBe(line);
	});

	it('treats the last word as done when there is no bar', () => {
		expect(formatTodoLine(parseTodoLine('TODO STARTED FINISHED'))).toBe('TODO STARTED | FINISHED');
	});

	it('flattens to the same config org reads from a file', () => {
		const line = 'TODO(t) WAIT(w@/!) | DONE(d!)';
		const fromFile = fileTodoKeywords(`#+TODO: ${line}\n`)!;
		const fromEditor = sequencesToConfig([parseTodoLine(line)]);
		expect(fromEditor.todoKeywords).toEqual(fromFile.todoKeywords);
		expect(fromEditor.doneKeywords).toEqual(fromFile.doneKeywords);
		expect(fromEditor.log).toEqual(fromFile.log);
	});

	it('merges several sequences and recovers them', () => {
		const config = sequencesToConfig([
			parseTodoLine('TODO | DONE'),
			parseTodoLine('BUG FIX | FIXED'),
		]);
		expect(config.todoKeywords).toEqual(['TODO', 'BUG', 'FIX']);
		expect(config.doneKeywords).toEqual(['DONE', 'FIXED']);
		expect(configToSequences(config).map(formatTodoLine)).toEqual([
			'TODO | DONE',
			'BUG FIX | FIXED',
		]);
		expect(
			configToSequences({ todoKeywords: ['TODO'], doneKeywords: ['DONE'] }).map(formatTodoLine),
		).toEqual(['TODO | DONE']);
	});
});
