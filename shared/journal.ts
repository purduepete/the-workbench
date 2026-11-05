import { journalLimits } from './contracts.js';
import type {
    GlobalNoteSave,
    JournalOutcome,
    JournalSave,
    NoteCategory,
    ServerGlobalNote,
    ServerJournalEntry,
} from './contracts.js';

export type CurrentEntry = Pick<ServerJournalEntry, 'body' | 'tags' | 'category' | 'deleted' | 'version'>;

export type SaveDecision =
    | {
          outcome: Extract<JournalOutcome, 'created' | 'updated' | 'merged'>;
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
 * dated separator unless its text is already there, so a retried or re-queued edit never duplicates text.
 */
export function resolveSave(current: CurrentEntry | null, save: JournalSave): SaveDecision {
    if (!current || current.deleted)
        return { outcome: 'created', body: save.body, tags: save.tags, category: save.category, bump: true };
    if (save.baseVersion === current.version)
        return {
            outcome: 'updated',
            body: save.body,
            tags: save.tags,
            category: save.category === undefined ? current.category : save.category,
            bump: true,
        };
    const body = current.body.includes(save.body)
        ? current.body
        : `${current.body}\n\n--- Edit from ${save.editedLabel} ---\n${save.body}`;
    const tags = unionTags(current.tags, save.tags);
    if (body.length > journalLimits.body || tags.length > journalLimits.tags) return { outcome: 'overflow' };
    const changed = body !== current.body || tags.length !== current.tags.length;
    return { outcome: 'merged', body, tags, category: current.category, bump: changed };
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
