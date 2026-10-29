import { describe, expect, it } from 'vitest';
import { filterIdeas, formatIdeaTimestamp, parseTags } from './ideas';
import type { Idea } from './types';

const ideas: Idea[] = [
    {
        id: 'older',
        title: 'Weekend project',
        body: 'Build a small greenhouse',
        tags: ['home', 'garden'],
        createdAt: '2026-10-27T18:00:00.000Z',
        updatedAt: '2026-10-27T18:00:00.000Z',
        pinned: false,
        archived: false,
        solution: null,
        status: 'open',
    },
    {
        id: 'pinned',
        title: 'Book idea',
        body: 'Collect stories from family',
        tags: ['writing'],
        createdAt: '2026-10-28T18:00:00.000Z',
        updatedAt: '2026-10-28T18:00:00.000Z',
        pinned: true,
        archived: false,
        solution: null,
        status: 'open',
    },
    {
        id: 'archived',
        title: 'Old thought',
        body: 'Keep for later',
        tags: ['writing'],
        createdAt: '2026-10-29T18:00:00.000Z',
        updatedAt: '2026-10-29T18:00:00.000Z',
        pinned: false,
        archived: true,
        solution: null,
        status: 'open',
    },
];

describe('filterIdeas', () => {
    it('shows active ideas and orders pinned ideas first', () => {
        expect(filterIdeas(ideas, 'all', '', null).map((idea) => idea.id)).toEqual(['pinned', 'older']);
    });

    it('searches title, body and tags without case sensitivity', () => {
        expect(filterIdeas(ideas, 'all', 'GREENHOUSE', null).map((idea) => idea.id)).toEqual(['older']);
        expect(filterIdeas(ideas, 'all', 'WRITING', null).map((idea) => idea.id)).toEqual(['pinned']);
    });

    it('filters pinned, archived and selected tag views', () => {
        expect(filterIdeas(ideas, 'pinned', '', null).map((idea) => idea.id)).toEqual(['pinned']);
        expect(filterIdeas(ideas, 'archived', '', null).map((idea) => idea.id)).toEqual(['archived']);
        expect(filterIdeas(ideas, 'all', '', 'garden').map((idea) => idea.id)).toEqual(['older']);
    });

    it('filters by linked solution, unlinked ideas, and searches the solution id', () => {
        const linked = ideas.map((idea) => (idea.id === 'older' ? { ...idea, solution: 'ferry-tracker' } : idea));
        expect(filterIdeas(linked, 'all', '', null, 'ferry-tracker').map((idea) => idea.id)).toEqual(['older']);
        expect(filterIdeas(linked, 'all', '', null, 'none').map((idea) => idea.id)).toEqual(['pinned']);
        expect(filterIdeas(linked, 'all', 'ferry', null).map((idea) => idea.id)).toEqual(['older']);
    });
});

describe('idea helpers', () => {
    it('deduplicates tags without regard to case and limits the tag count', () => {
        expect(parseTags(' home, HOME, writing , , family ')).toEqual(['home', 'writing', 'family']);
        expect(parseTags(Array.from({ length: 14 }, (_, index) => `tag${index}`).join(','))).toHaveLength(12);
    });

    it('formats timestamps using local 24-hour time', () => {
        const date = new Date(2026, 9, 29, 7, 5);
        expect(formatIdeaTimestamp(date.toISOString())).toBe('10/29/2026 07:05');
    });
});
