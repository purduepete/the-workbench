import type { ServerJournalEntry } from '../shared/contracts';

/** A journal entry as the page shows it: the confirmed row with any queued change on top. */
export interface JournalEntry {
    entryDate: string;
    body: string;
    tags: string[];
    updatedAt: string;
}

export interface WeekGroup {
    /** Monday of the week, `YYYY-MM-DD`. */
    weekStart: string;
    entries: JournalEntry[];
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

/** Newest week first, newest day first inside each week. */
export function groupByWeek(entries: JournalEntry[]): WeekGroup[] {
    const sorted = [...entries].sort((a, b) => b.entryDate.localeCompare(a.entryDate));
    const groups: WeekGroup[] = [];
    for (const entry of sorted) {
        const start = weekStart(entry.entryDate);
        const last = groups.at(-1);
        if (last?.weekStart === start) last.entries.push(entry);
        else groups.push({ weekStart: start, entries: [entry] });
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
                entry.body.toLocaleLowerCase().includes(normalizedQuery) ||
                entry.tags.some((value) => value.toLocaleLowerCase().includes(normalizedQuery)))
    );
}

export const toJournalEntry = (row: ServerJournalEntry): JournalEntry => ({
    entryDate: row.entryDate,
    body: row.body,
    tags: [...row.tags],
    updatedAt: row.updatedAt,
});
