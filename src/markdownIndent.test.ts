import { describe, expect, it } from 'vitest';
import { indentMarkdown, markdownIndentDepth } from './markdownIndent';

describe('Markdown indentation', () => {
    it('inserts spaces at the caret', () => {
        expect(indentMarkdown('ab', 1, 1, false)).toEqual({ value: 'a    b', start: 5, end: 5 });
    });

    it('indents selected lines without changing the next line at a newline boundary', () => {
        expect(indentMarkdown('one\ntwo\nthree', 0, 8, false)).toEqual({
            value: '    one\n    two\nthree',
            start: 4,
            end: 16,
        });
    });

    it('outdents partial spaces and legacy tabs while preserving selection', () => {
        expect(indentMarkdown('  one\n\ttwo', 0, 10, true)).toEqual({
            value: 'one\ntwo',
            start: 0,
            end: 7,
        });
        expect(indentMarkdown('    one', 2, 2, true)).toEqual({ value: 'one', start: 0, end: 0 });
    });

    it('leaves unindented text unchanged', () => {
        expect(indentMarkdown('one', 2, 2, true)).toEqual({ value: 'one', start: 2, end: 2 });
    });

    it('counts indentation on the current line with tab stops', () => {
        expect(markdownIndentDepth('one\n    two', 8)).toBe(1);
        expect(markdownIndentDepth(' \t    two', 8)).toBe(2);
        expect(markdownIndentDepth('   two', 4)).toBe(0);
    });
});
