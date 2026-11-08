import { describe, expect, it } from 'vitest';
import { setMarkdownTask } from './markdownTasks';

describe('setMarkdownTask', () => {
    const body = [
        'Intro',
        '',
        '- [ ] Buy milk',
        '- [x] Call Sam',
        '  - [ ] Nested step',
        '1. [ ] Numbered',
        '> - [ ] Quoted',
    ].join('\n');
    const offsetOf = (text: string) => body.indexOf(text);

    it('ticks and clears only the chosen item', () => {
        const ticked = setMarkdownTask(body, offsetOf('- [ ] Buy'), true);
        expect(ticked?.split('\n')[2]).toBe('- [x] Buy milk');
        expect(ticked?.split('\n').filter((_line, index) => index !== 2)).toEqual(
            body.split('\n').filter((_line, index) => index !== 2)
        );
        expect(setMarkdownTask(body, offsetOf('- [x] Call'), false)?.split('\n')[3]).toBe('- [ ] Call Sam');
    });

    it('handles nested, numbered and quoted items from any offset on the line', () => {
        expect(setMarkdownTask(body, offsetOf('- [ ] Nested'), true)?.split('\n')[4]).toBe('  - [x] Nested step');
        expect(setMarkdownTask(body, offsetOf('Numbered'), true)?.split('\n')[5]).toBe('1. [x] Numbered');
        expect(setMarkdownTask(body, offsetOf('> - [ ]'), true)?.split('\n')[6]).toBe('> - [x] Quoted');
    });

    it('returns null when the line is not a task item', () => {
        expect(setMarkdownTask(body, 0, true)).toBeNull();
        expect(setMarkdownTask(body, body.length + 1, true)).toBeNull();
        expect(setMarkdownTask('- plain item', 0, true)).toBeNull();
    });
});
