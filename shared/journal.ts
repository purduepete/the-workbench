import { commentLimits, journalLimits } from './contracts.js';
import type {
    GlobalNoteSave,
    JournalCommentSave,
    JournalOutcome,
    JournalSave,
    NoteCategory,
    ServerGlobalNote,
    ServerJournalComment,
    ServerJournalEntry,
} from './contracts.js';

export type CurrentEntry = Pick<ServerJournalEntry, 'title' | 'body' | 'tags' | 'category' | 'deleted' | 'version'>;

/** Thrown when an older client's change names a day and section that now hold more than one note. */
export class JournalSectionRequiredError extends Error {
    constructor() {
        super('This day has more than one note in this section. Reload the app, then save the note again.');
    }
}

/** Old clients omitted category when each day had only one entry. Never guess once a day has multiple sections. */
export function resolveJournalCategory(
    category: NoteCategory | undefined,
    entries: Pick<ServerJournalEntry, 'category'>[]
): NoteCategory {
    if (category !== undefined) return category;
    if (new Set(entries.map((entry) => entry.category ?? null)).size > 1) throw new JournalSectionRequiredError();
    return entries[0]?.category ?? null;
}

/**
 * Picks the note an older client's change (no id) meant: that day and section held at most one note then. A live note
 * wins over tombstones, the newest tombstone is revived, and an empty slot gets a new id. Never guess between two live
 * notes.
 */
export function resolveLegacyNote(
    candidates: Pick<ServerJournalEntry, 'id' | 'deleted' | 'updatedAt'>[],
    newId: () => string
): string {
    const live = candidates.filter((entry) => !entry.deleted);
    if (live.length > 1) throw new JournalSectionRequiredError();
    if (live[0]) return live[0].id;
    const newest = [...candidates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return newest?.id ?? newId();
}

export type SaveDecision =
    | {
          outcome: Extract<JournalOutcome, 'created' | 'updated' | 'merged'>;
          title: string;
          body: string;
          tags: string[];
          category?: NoteCategory;
          bump: boolean;
      }
    | { outcome: 'overflow' };

/** Tags compare without case; the first spelling wins. */
export function unionTags(current: string[], incoming: string[]): string[] {
    const result = [...current];
    const seen = new Set(current.map((tag) => tag.toLocaleLowerCase()));
    for (const tag of incoming) {
        const key = tag.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
    }
    return result;
}

/**
 * Decides how a save lands. A save based on the current version replaces the entry. A stale save is appended under a
 * dated separator unless its text is already there, so a retried or re-queued edit never duplicates text. A stale save
 * keeps the current title unless the note had none. An older client's save (no title) keeps the title.
 */
export function resolveSave(current: CurrentEntry | null, save: JournalSave): SaveDecision {
    const incomingTitle = save.title ?? current?.title ?? '';
    if (!current || current.deleted)
        return {
            outcome: 'created',
            title: save.title ?? '',
            body: save.body,
            tags: save.tags,
            category: save.category,
            bump: true,
        };
    if (save.baseVersion === current.version)
        return {
            outcome: 'updated',
            title: incomingTitle,
            body: save.body,
            tags: save.tags,
            category: save.category === undefined ? current.category : save.category,
            bump: true,
        };
    const body = current.body.includes(save.body)
        ? current.body
        : `${current.body}\n\n--- Edit from ${save.editedLabel} ---\n${save.body}`;
    const tags = unionTags(current.tags, save.tags);
    const title = current.title || incomingTitle;
    if (body.length > journalLimits.body || tags.length > journalLimits.tags) return { outcome: 'overflow' };
    const changed = body !== current.body || tags.length !== current.tags.length || title !== current.title;
    return { outcome: 'merged', title, body, tags, category: current.category, bump: changed };
}
export class JournalOverflowError extends Error {
    constructor() {
        super('Merging this edit would make the entry longer than the limit.');
    }
}

export type GlobalSaveDecision =
    | {
          outcome: Extract<JournalOutcome, 'created' | 'updated' | 'merged'>;
          title: string;
          body: string;
          tags: string[];
          bump: boolean;
      }
    | { outcome: 'overflow' };

export type CurrentGlobalNote = Pick<ServerGlobalNote, 'title' | 'body' | 'tags' | 'deleted' | 'version'>;

/** Global notes retain title-only edits while sharing the journal's body merge and limits. */
export function resolveGlobalSave(current: CurrentGlobalNote | null, save: GlobalNoteSave): GlobalSaveDecision {
    if (!current || current.deleted) {
        return {
            outcome: 'created',
            title: save.title,
            body: save.body,
            tags: save.tags,
            bump: true,
        };
    }
    if (save.baseVersion === current.version) {
        return {
            outcome: 'updated',
            title: save.title,
            body: save.body,
            tags: save.tags,
            bump: true,
        };
    }

    const titleChanged = save.title !== current.title;
    const marker = titleChanged
        ? `--- Edit from ${save.editedLabel}, titled "${save.title}" ---`
        : `--- Edit from ${save.editedLabel} ---`;
    const alreadyRecorded = current.body.includes(marker);
    let body = current.body;
    if (!alreadyRecorded && (titleChanged || (save.body.length > 0 && !current.body.includes(save.body)))) {
        body = `${current.body}${current.body ? '\n\n' : ''}${marker}`;
    }
    if (save.body.length > 0 && !current.body.includes(save.body)) body += `${body ? '\n' : ''}${save.body}`;
    const tags = unionTags(current.tags, save.tags);
    if (body.length > journalLimits.body || tags.length > journalLimits.tags) return { outcome: 'overflow' };
    const bump = body !== current.body || tags.length !== current.tags.length;
    return {
        outcome: 'merged',
        title: current.title,
        body,
        tags,
        bump,
    };
}

export type CommentSaveDecision =
    | { outcome: Extract<JournalOutcome, 'created' | 'updated' | 'merged'>; body: string; bump: boolean }
    | { outcome: 'overflow' };

/** Same rule as daily notes: a current edit replaces, a stale edit is appended under a dated separator. */
export function resolveCommentSave(
    current: Pick<ServerJournalComment, 'body' | 'deleted' | 'version'> | null,
    save: JournalCommentSave
): CommentSaveDecision {
    if (!current || current.deleted) return { outcome: 'created', body: save.body, bump: true };
    if (save.baseVersion === current.version) return { outcome: 'updated', body: save.body, bump: true };
    if (current.body.includes(save.body)) return { outcome: 'merged', body: current.body, bump: false };
    const body = `${current.body}\n\n--- Edit from ${save.editedLabel} ---\n${save.body}`;
    if (body.length > commentLimits.body) return { outcome: 'overflow' };
    return { outcome: 'merged', body, bump: true };
}
