import type { Idea, IdeaView } from './types';

export const VIEW_STORAGE_KEY = 'idea-notes.view';

export function readIdeaView(): { view: IdeaView; error: string | null } {
    try {
        const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
        if (saved === 'pinned' || saved === 'archived' || saved === 'all') return { view: saved, error: null };
        return { view: 'all', error: null };
    } catch {
        return { view: 'all', error: 'Your selected view could not be restored from browser storage.' };
    }
}

export function writeIdeaView(view: IdeaView): string | null {
    try {
        window.localStorage.setItem(VIEW_STORAGE_KEY, view);
        return null;
    } catch {
        return 'Your view preference could not be saved. It will reset when you reopen this page.';
    }
}

export function filterIdeas(ideas: Idea[], view: IdeaView, query: string, selectedTag: string | null): Idea[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return ideas
        .filter((idea) => {
            if (view === 'archived' ? !idea.archived : idea.archived) return false;
            if (view === 'pinned' && !idea.pinned) return false;
            if (selectedTag && !idea.tags.some((tag) => tag.toLocaleLowerCase() === selectedTag.toLocaleLowerCase())) {
                return false;
            }
            if (!normalizedQuery) return true;
            return [idea.title, idea.body, ...idea.tags].some((value) =>
                value.toLocaleLowerCase().includes(normalizedQuery)
            );
        })
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

export function formatIdeaTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseTags(value: string): string[] {
    const seen = new Set<string>();
    return value
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => {
            const key = tag.toLocaleLowerCase();
            if (!tag || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 12);
}
