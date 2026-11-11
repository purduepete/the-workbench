import { afterEach, describe, expect, it, vi } from 'vitest';
import { shortcutRoute } from './pageShortcuts';
import { readSolutionFilter, SOLUTION_FILTER_STORAGE_KEY, writeSolutionFilter } from './ideas';
import { NOTE_FILTER_STORAGE_KEY, readNoteFilter, writeNoteFilter } from './journal';

const key = (value: string, extra: Partial<Parameters<typeof shortcutRoute>[0]> = {}) => ({
    key: value,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    defaultPrevented: false,
    target: { closest: () => null } as unknown as EventTarget,
    ...extra,
});
const noDialog = { querySelector: () => null } as unknown as Document;

describe('page shortcuts', () => {
    it('opens Ideas, Notes and Tasks with I, N and T in either case', () => {
        expect(shortcutRoute(key('i'), noDialog)).toBe('/ideas');
        expect(shortcutRoute(key('N'), noDialog)).toBe('/notes');
        expect(shortcutRoute(key('t'), noDialog)).toBe('/tasks');
        expect(shortcutRoute(key('x'), noDialog)).toBeNull();
    });

    it('ignores modifiers, repeats and handled keys', () => {
        for (const extra of [
            { ctrlKey: true },
            { metaKey: true },
            { altKey: true },
            { repeat: true },
            { defaultPrevented: true },
        ]) {
            expect(shortcutRoute(key('n', extra), noDialog)).toBeNull();
        }
    });

    it('ignores typing in fields and keys pressed while a dialog is open', () => {
        const field = {
            closest: (selector: string) => (selector.includes('textarea') ? {} : null),
        } as unknown as EventTarget;
        expect(shortcutRoute(key('t', { target: field }), noDialog)).toBeNull();
        const withDialog = { querySelector: () => ({}) } as unknown as Document;
        expect(shortcutRoute(key('t'), withDialog)).toBeNull();
    });
});

describe('saved filters', () => {
    afterEach(() => vi.unstubAllGlobals());

    const storage = (values: Record<string, string> = {}) => {
        vi.stubGlobal('window', {
            localStorage: {
                getItem: (name: string) => values[name] ?? null,
                setItem: (name: string, value: string) => {
                    values[name] = value;
                },
            },
        });
        return values;
    };

    it('remembers the notes filter and falls back to All for unknown values', () => {
        const values = storage();
        expect(readNoteFilter()).toBe('all');
        expect(writeNoteFilter('work')).toBeNull();
        expect(values[NOTE_FILTER_STORAGE_KEY]).toBe('work');
        expect(readNoteFilter()).toBe('work');
        values[NOTE_FILTER_STORAGE_KEY] = 'garbage';
        expect(readNoteFilter()).toBe('all');
    });

    it('remembers the ideas solution filter', () => {
        const values = storage();
        expect(readSolutionFilter()).toBe('all');
        expect(writeSolutionFilter('ferry-tracker')).toBeNull();
        expect(values[SOLUTION_FILTER_STORAGE_KEY]).toBe('ferry-tracker');
        expect(readSolutionFilter()).toBe('ferry-tracker');
    });

    it('keeps working when browser storage is unavailable', () => {
        vi.stubGlobal('window', {
            localStorage: {
                getItem: () => {
                    throw new Error('blocked');
                },
                setItem: () => {
                    throw new Error('blocked');
                },
            },
        });
        expect(readNoteFilter()).toBe('all');
        expect(readSolutionFilter()).toBe('all');
        expect(writeNoteFilter('home')).toContain('could not be saved');
        expect(writeSolutionFilter('none')).toContain('could not be saved');
    });
});
