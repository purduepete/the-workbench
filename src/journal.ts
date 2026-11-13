import type { NoteCategory, ServerJournalEntry } from '../shared/contracts';
import type { NoteFilter } from './NoteCategories';

export const NOTE_FILTER_STORAGE_KEY = 'the-workbench.note-filter';

export function readNoteFilter(): NoteFilter {
    try {
        const saved = window.localStorage.getItem(NOTE_FILTER_STORAGE_KEY);
        return saved === 'home' || saved === 'global' ? saved : 'work';
    } catch {
        return 'work';
    }
}

export function writeNoteFilter(filter: NoteFilter): string | null {
    try {
        window.localStorage.setItem(NOTE_FILTER_STORAGE_KEY, filter);
        return null;
    } catch {
        return 'Your note filter could not be saved. It will reset when you reopen this page.';
    }
}

/** A daily note as the page shows it: the confirmed row with any queued change on top. */
export interface JournalEntry {
    id: string;
    entryDate: string;
    title: string;
    body: string;
    tags: string[];
    category?: NoteCategory;
    createdAt: string;
    updatedAt: string;
}

/** The note's title, or its first line without Markdown markers when it has none. */
export function noteHeading(entry: Pick<JournalEntry, 'title' | 'body'>): string {
    if (entry.title.trim()) return entry.title.trim();
    const line = entry.body
        .split('\n')
        .map((value) => value.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+|>\s*)/, '').trim())
        .find(Boolean);
    const text = (line ?? '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]/g, '')
        .trim();
    return text.slice(0, 140) || 'Untitled note';
}

export interface DayGroup {
    entryDate: string;
    /** Notes in the order they were written. */
    entries: JournalEntry[];
}

export interface WeekGroup {
    /** Monday of the week, `YYYY-MM-DD`. */
    weekStart: string;
    entries: JournalEntry[];
    /** Newest day first. */
    days: DayGroup[];
}

const pad = (part: number) => String(part).padStart(2, '0');

/** Today's calendar day in the device's zone. Never use toISOString here; it gives the UTC day. */
export function localDateKey(date = new Date()): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DD` to `mm/dd/yyyy` by string parts, so no time zone can shift the day. */
export function formatEntryDate(entryDate: string): string {
    const [year, month, day] = entryDate.split('-');
    return `${month}/${day}/${year}`;
}

/** The Monday on or before the given day. Built at local noon so a DST change can never move it a day. */
export function weekStart(entryDate: string): string {
    const [year, month, day] = entryDate.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return localDateKey(date);
}

/** Newest week first, newest day first inside each week, and each day's notes in the order they were written. */
export function groupByWeek(entries: JournalEntry[]): WeekGroup[] {
    const sorted = [...entries].sort(
        (a, b) =>
            b.entryDate.localeCompare(a.entryDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );
    const groups: WeekGroup[] = [];
    for (const entry of sorted) {
        const start = weekStart(entry.entryDate);
        let week = groups.at(-1);
        if (week?.weekStart !== start) {
            week = { weekStart: start, entries: [], days: [] };
            groups.push(week);
        }
        week.entries.push(entry);
        const day = week.days.at(-1);
        if (day?.entryDate === entry.entryDate) day.entries.push(entry);
        else week.days.push({ entryDate: entry.entryDate, entries: [entry] });
    }
    return groups;
}

export function filterEntries(entries: JournalEntry[], query: string, selectedTag: string | null): JournalEntry[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const tag = selectedTag?.toLocaleLowerCase();
    return entries.filter(
        (entry) =>
            (!tag || entry.tags.some((value) => value.toLocaleLowerCase() === tag)) &&
            (!normalizedQuery ||
                entry.title.toLocaleLowerCase().includes(normalizedQuery) ||
                entry.body.toLocaleLowerCase().includes(normalizedQuery) ||
                entry.tags.some((value) => value.toLocaleLowerCase().includes(normalizedQuery)))
    );
}

export const toJournalEntry = (row: ServerJournalEntry): JournalEntry => ({
    id: row.id,
    entryDate: row.entryDate,
    title: row.title,
    body: row.body,
    tags: [...row.tags],
    category: row.category,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

/** Weeks shown with their own dates; notes before them go under one Older group. */
export const RECENT_WEEKS = 4;

export interface NoteGroupView {
    /** A week's Monday, or `older`. */
    key: string;
    title: string;
    entries: JournalEntry[];
    days: DayGroup[];
}

/** The group a day lands in: its week when within the recent weeks, otherwise `older`. */
export function noteGroupKey(entryDate: string, today: string, recentWeeks = RECENT_WEEKS): string {
    const [year, month, day] = weekStart(today).split('-').map(Number);
    const cutoff = localDateKey(new Date(year, month - 1, day - 7 * (recentWeeks - 1), 12));
    const start = weekStart(entryDate);
    return start >= cutoff ? start : 'older';
}

/** Recent weeks newest first, then one Older group holding every earlier day. */
export function groupRecentWeeks(entries: JournalEntry[], today: string, recentWeeks = RECENT_WEEKS): NoteGroupView[] {
    const groups: NoteGroupView[] = [];
    let older: NoteGroupView | undefined;
    for (const week of groupByWeek(entries)) {
        if (noteGroupKey(week.weekStart, today, recentWeeks) !== 'older') {
            groups.push({ key: week.weekStart, title: `Week of ${formatEntryDate(week.weekStart)}`, ...week });
            continue;
        }
        older ??= { key: 'older', title: 'Older', entries: [], days: [] };
        older.entries.push(...week.entries);
        older.days.push(...week.days);
    }
    return older ? [...groups, older] : groups;
}
