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
        priority: 'high',
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
        priority: 'high',
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
        priority: 'high',
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

describe('idea order', () => {
    const make = (
        id: string,
        status: Idea['status'],
        priority: Idea['priority'],
        updatedAt = '2026-10-27T18:00:00.000Z',
        pinned = false
    ): Idea => ({
        id,
        title: id,
        body: '',
        tags: [],
        createdAt: updatedAt,
        updatedAt,
        pinned,
        archived: false,
        solution: status === 'n/a' ? null : 'ferry-tracker',
        status,
        priority,
    });

    it('orders pinned first, then status, then priority, then newest and id', () => {
        const list = [
            make('na-high', 'n/a', 'high'),
            make('done-high', 'done', 'high'),
            make('open-low', 'open', 'low'),
            make('progress-medium', 'in-progress', 'medium'),
            make('open-medium', 'open', 'medium'),
            make('open-high-old', 'open', 'high', '2026-10-01T18:00:00.000Z'),
            make('open-high-new', 'open', 'high', '2026-10-28T18:00:00.000Z'),
            make('progress-high', 'in-progress', 'high'),
            make('done-low', 'done', 'low'),
            make('pinned-done-low', 'done', 'low', '2026-10-27T18:00:00.000Z', true),
            make('pinned-open-high', 'open', 'high', '2026-10-27T18:00:00.000Z', true),
            make('tie-b', 'done', 'medium'),
            make('tie-a', 'done', 'medium'),
        ];
        expect(filterIdeas(list, 'all', '', null).map((idea) => idea.id)).toEqual([
            'pinned-open-high',
            'pinned-done-low',
            'open-high-new',
            'open-high-old',
            'open-medium',
            'open-low',
            'progress-high',
            'progress-medium',
            'done-high',
            'tie-a',
            'tie-b',
            'done-low',
            'na-high',
        ]);
    });

    it('applies the same order to the archived view', () => {
        const list = [make('low', 'open', 'low'), make('high', 'open', 'high')].map((idea) => ({
            ...idea,
            archived: true,
        }));
        expect(filterIdeas(list, 'archived', '', null).map((idea) => idea.id)).toEqual(['high', 'low']);
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
