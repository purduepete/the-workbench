import { useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { CalendarDays, CalendarPlus, Check, Clock3, NotebookPen, Plus, Search, Tag, Trash2, X } from 'lucide-react';
import { globalNoteLimits, journalLimits } from '../shared/contracts';
import { formatIdeaTimestamp, parseTags } from './ideas';
import { filterEntries, formatEntryDate, groupByWeek, weekStart } from './journal';
import type { JournalEntry } from './journal';
import { CalendarDialog } from './CalendarDialog';
import { NoteGroup } from './NoteGroup';
import type { GlobalNote } from './globalNotesSync';
import { PageLoading } from './Loading';
import { useTheme } from './ThemeContext';
import type { useJournalSync } from './useJournalSync';
import type { useGlobalNotesSync } from './useGlobalNotesSync';
import { useEditorDismissal } from './useEditorDismissal';

interface JournalDialogProps {
    entryDate: string;
    entry: JournalEntry | undefined;
    onClose: () => void;
    onSave: (body: string, tags: string[]) => string | null;
    onDelete: () => string | null;
    onDraftProtectionChange: (protectedDraft: boolean) => void;
    fromCalendar?: boolean;
}

function JournalDialog({
    entryDate,
    entry,
    onClose,
    onSave,
    onDelete,
    onDraftProtectionChange,
    fromCalendar = false,
}: JournalDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);
    const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const isAppleTouchDevice =
        /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const [formError, setFormError] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [confirmingEmpty, setConfirmingEmpty] = useState(false);
    const dismissal = useEditorDismissal(dialogRef, Boolean(entry?.body.trim()), onDraftProtectionChange);

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const returnFocus = returnFocusRef.current;
        // React ignores autoFocus on forms; set it before showModal so iPad does not raise the keyboard.
        formRef.current?.toggleAttribute('autofocus', isAppleTouchDevice);
        if (dialog && !dialog.open) dialog.showModal();
        if (isAppleTouchDevice) dialog?.focus({ preventScroll: true });
        else bodyRef.current?.focus({ preventScroll: true });
        return () => {
            if (dialog?.open) dialog.close();
            if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        };
    }, [isAppleTouchDevice]);

    const finish = (error: string | null) => {
        if (error) setFormError(error);
        else onClose();
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const body = String(formData.get('body') ?? '').trim();
        if (!body) {
            if (!entry) {
                setFormError('Write something before saving this entry.');
                bodyRef.current?.focus();
                return;
            }
            // Clearing an existing entry deletes it, so ask first.
            if (!confirmingEmpty) {
                setConfirmingEmpty(true);
                setFormError('The entry is empty. Save again to delete it.');
                return;
            }
            finish(onDelete());
            return;
        }
        finish(onSave(body, parseTags(String(formData.get('tags') ?? ''), journalLimits.tags)));
    };

    const handleDelete = () => {
        if (!confirmingDelete) {
            setConfirmingDelete(true);
            return;
        }
        finish(onDelete());
    };

    return (
        <dialog
            ref={dialogRef}
            className="dialog-backdrop editor-dialog"
            data-replacing={fromCalendar}
            aria-labelledby="journal-dialog-title"
            tabIndex={-1}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                if (!dismissal.isProtected()) onClose();
            }}
            onCancel={(event) => {
                event.preventDefault();
                if (!dismissal.isProtected()) onClose();
            }}
            onClick={(event) => {
                if (event.target === dialogRef.current && !dismissal.isProtected()) onClose();
            }}
        >
            <form
                ref={formRef}
                className="idea-form"
                tabIndex={isAppleTouchDevice ? -1 : undefined}
                onSubmit={handleSubmit}
                onChange={() => {
                    const form = formRef.current;
                    if (!form) return;
                    dismissal.setProtectedDraft(Boolean(String(new FormData(form).get('body') ?? '').trim()));
                }}
            >
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Personal note</p>
                        <h2 id="journal-dialog-title">Entry for {formatEntryDate(entryDate)}</h2>
                    </div>
                </div>
                <label className="field-group">
                    <span className="field-label">Entry</span>
                    <textarea
                        ref={bodyRef}
                        className="field-textarea journal-textarea"
                        name="body"
                        maxLength={journalLimits.body}
                        placeholder="What happened today, what you noticed, what is on your mind..."
                        defaultValue={entry?.body ?? ''}
                        onChange={() => setConfirmingEmpty(false)}
                    />
                </label>
                <label className="field-group">
                    <span className="field-label">Tags</span>
                    <input
                        className="field-input"
                        name="tags"
                        type="text"
                        maxLength={2000}
                        placeholder="health, family, work"
                        defaultValue={entry?.tags.join(', ') ?? ''}
                        aria-describedby="journal-tag-hint"
                    />
                    <span className="field-hint" id="journal-tag-hint">
                        Separate tags with commas.
                    </span>
                </label>
                {formError && (
                    <p className="dialog-error" role="alert">
                        {formError}
                    </p>
                )}
                <div className="dialog-footer">
                    {entry && (
                        <button
                            type="button"
                            className="danger-button"
                            data-confirming={confirmingDelete}
                            aria-label={confirmingDelete ? 'Confirm delete' : 'Delete entry'}
                            onClick={handleDelete}
                            onBlur={() => setConfirmingDelete(false)}
                        >
                            <Trash2 size={15} aria-hidden="true" />
                            {confirmingDelete ? 'Confirm' : 'Delete'}
                        </button>
                    )}
                    <button type="button" className="secondary-button" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="submit" className="primary-button">
                        <Check size={15} aria-hidden="true" />
                        Save entry
                    </button>
                </div>
            </form>
        </dialog>
    );
}

function GlobalNoteDialog({
    note,
    id,
    onClose,
    onSave,
    onDelete,
    onDraftProtectionChange,
}: {
    note: GlobalNote | undefined;
    id: string;
    onClose: () => void;
    onSave: (note: GlobalNote) => string | null;
    onDelete: () => string | null;
    onDraftProtectionChange: (protectedDraft: boolean) => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const isAppleTouchDevice =
        /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const [error, setError] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const dismissal = useEditorDismissal(
        dialogRef,
        Boolean(note?.title.trim() || note?.body.trim()),
        onDraftProtectionChange
    );

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const returnFocus = returnFocusRef.current;
        formRef.current?.toggleAttribute('autofocus', isAppleTouchDevice);
        if (dialog && !dialog.open) dialog.showModal();
        if (isAppleTouchDevice) dialog?.focus({ preventScroll: true });
        else titleRef.current?.focus({ preventScroll: true });
        return () => {
            if (dialog?.open) dialog.close();
            if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        };
    }, [isAppleTouchDevice]);

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const title = String(formData.get('title') ?? '').trim();
        if (!title) {
            setError('Add a title before saving this global note.');
            titleRef.current?.focus();
            return;
        }
        const result = onSave({
            id,
            title,
            body: String(formData.get('body') ?? ''),
            tags: parseTags(String(formData.get('tags') ?? ''), globalNoteLimits.tags),
            updatedAt: new Date().toISOString(),
        });
        if (result) setError(result);
        else onClose();
    };

    const handleDelete = () => {
        if (!confirmingDelete) {
            setConfirmingDelete(true);
            return;
        }
        const result = onDelete();
        if (result) setError(result);
        else onClose();
    };

    return (
        <dialog
            ref={dialogRef}
            className="dialog-backdrop editor-dialog"
            aria-labelledby="global-note-title-label"
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                if (!dismissal.isProtected()) onClose();
            }}
            onCancel={(event) => {
                event.preventDefault();
                if (!dismissal.isProtected()) onClose();
            }}
            onClick={(event) => {
                if (event.target === dialogRef.current && !dismissal.isProtected()) onClose();
            }}
        >
            <form
                ref={formRef}
                className="idea-form"
                onSubmit={submit}
                onChange={() => {
                    const form = formRef.current;
                    if (!form) return;
                    const data = new FormData(form);
                    dismissal.setProtectedDraft(
                        Boolean(String(data.get('title') ?? '').trim() || String(data.get('body') ?? '').trim())
                    );
                }}
            >
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Date-agnostic note</p>
                        <h2 id="global-note-title-label">{note ? 'Edit global note' : 'New global note'}</h2>
                    </div>
                </div>
                <label className="field-group">
                    <span className="field-label">Title</span>
                    <input
                        ref={titleRef}
                        className="field-input"
                        name="title"
                        type="text"
                        maxLength={globalNoteLimits.title}
                        defaultValue={note?.title ?? ''}
                        placeholder="A note to keep"
                        required
                    />
                </label>
                <label className="field-group">
                    <span className="field-label">Note</span>
                    <textarea
                        className="field-textarea journal-textarea"
                        name="body"
                        maxLength={globalNoteLimits.body}
                        defaultValue={note?.body ?? ''}
                        placeholder="Add details..."
                    />
                </label>
                <label className="field-group">
                    <span className="field-label">Tags</span>
                    <input
                        className="field-input"
                        name="tags"
                        type="text"
                        maxLength={2000}
                        defaultValue={note?.tags.join(', ') ?? ''}
                        placeholder="personal, reference"
                    />
                    <span className="field-hint">Separate tags with commas.</span>
                </label>
                {error && (
                    <p className="dialog-error" role="alert">
                        {error}
                    </p>
                )}
                <div className="dialog-footer">
                    {note && (
                        <button
                            type="button"
                            className="danger-button"
                            aria-label={confirmingDelete ? 'Confirm delete' : 'Delete global note'}
                            onClick={handleDelete}
                            onBlur={() => setConfirmingDelete(false)}
                        >
                            <Trash2 size={15} aria-hidden="true" />
                            {confirmingDelete ? 'Confirm' : 'Delete'}
                        </button>
                    )}
                    <button type="button" className="secondary-button" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="submit" className="primary-button">
                        <Check size={15} aria-hidden="true" />
                        Save note
                    </button>
                </div>
            </form>
        </dialog>
    );
}

export interface NotesPageProps {
    journal: ReturnType<typeof useJournalSync>;
    globalNotes: ReturnType<typeof useGlobalNotesSync>;
    ready: boolean;
    syncBadge: ReactNode;
    today: string;
    editingDate: string | undefined;
    setEditingDate: (entryDate: string | undefined) => void;
    onDraftProtectionChange: (protectedDraft: boolean) => void;
}

export function NotesPage({
    journal,
    globalNotes,
    ready,
    syncBadge,
    today,
    editingDate,
    setEditingDate,
    onDraftProtectionChange,
}: NotesPageProps) {
    const { storageWarning: themeStorageWarning } = useTheme();
    const notice = journal.notice ?? globalNotes.notice;
    const clearNotice = () => {
        journal.clearNotice();
        globalNotes.clearNotice();
    };
    const [query, setQuery] = useState('');
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [calendarSelection, setCalendarSelection] = useState(false);
    const [editingGlobalId, setEditingGlobalId] = useState<string | undefined>();
    const { entries } = journal;
    const visible = filterEntries(entries, query, selectedTag);
    const weeks = groupByWeek(visible);
    const filtering = Boolean(query || selectedTag);
    const allTags = Array.from(
        new Set([...entries.flatMap((entry) => entry.tags), ...globalNotes.notes.flatMap((note) => note.tags)])
    ).sort((a, b) => a.localeCompare(b));
    const editingEntry = editingDate ? entries.find((entry) => entry.entryDate === editingDate) : undefined;
    const globalNote = globalNotes.notes.find((note) => note.id === editingGlobalId);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const visibleGlobalNotes = globalNotes.notes.filter(
        (note) =>
            (!selectedTag || note.tags.some((tag) => tag.toLocaleLowerCase() === selectedTag.toLocaleLowerCase())) &&
            (!normalizedQuery ||
                note.title.toLocaleLowerCase().includes(normalizedQuery) ||
                note.body.toLocaleLowerCase().includes(normalizedQuery) ||
                note.tags.some((tag) => tag.toLocaleLowerCase().includes(normalizedQuery)))
    );
    const visibleHasContent = weeks.length > 0 || visibleGlobalNotes.length > 0;

    const renderGlobalSection = (notes: GlobalNote[]) =>
        notes.length > 0 && (
            <NoteGroup id="global-notes" title="Global notes" count={notes.length} item="note" isGlobal>
                {notes.map((note) => (
                    <article key={note.id} className="idea-card global-note-card">
                        <div className="idea-card-top">
                            <h4 className="global-note-title">{note.title}</h4>
                        </div>
                        <p className="idea-body journal-body">{note.body || 'No body text.'}</p>
                        {note.tags.length > 0 && (
                            <div className="idea-tags">
                                {note.tags.map((tag) => (
                                    <button
                                        key={tag.toLocaleLowerCase()}
                                        className="tag-chip tag-filter"
                                        type="button"
                                        aria-label={`Filter by ${tag}`}
                                        onClick={() => setSelectedTag(tag)}
                                    >
                                        <Tag size={10} aria-hidden="true" />
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="idea-card-bottom">
                            <span className="idea-date">
                                <Clock3 size={12} aria-hidden="true" />
                                <time dateTime={note.updatedAt}>{formatIdeaTimestamp(note.updatedAt)}</time>
                            </span>
                            <button
                                type="button"
                                className="edit-button"
                                aria-label={`Edit ${note.title}`}
                                onClick={() => setEditingGlobalId(note.id)}
                            >
                                Edit
                            </button>
                        </div>
                    </article>
                ))}
            </NoteGroup>
        );

    return (
        <>
            {notice && (
                <div className="storage-notice" role="alert">
                    <span>{notice}</span>
                    <button type="button" aria-label="Dismiss notice" onClick={clearNotice}>
                        <X size={16} aria-hidden="true" />
                    </button>
                </div>
            )}
            {themeStorageWarning && !notice && (
                <div className="storage-notice" role="alert">
                    <span>{themeStorageWarning}</span>
                </div>
            )}

            {!ready ? (
                <PageLoading
                    label="Loading notes"
                    message={
                        journal.status === 'offline'
                            ? 'You are offline. Notes will load when the connection returns.'
                            : journal.status === 'paused'
                              ? 'Notes could not sync. Retrying automatically.'
                              : undefined
                    }
                />
            ) : (
                <div className="data-enter">
                    <section className="intro" aria-label="Sync status">
                        <div className="intro-aside">{syncBadge}</div>
                    </section>

                    <section className="workspace" aria-label="Your notes">
                        <div className="workspace-tools">
                            <label className="search-wrap">
                                <Search size={16} aria-hidden="true" />
                                <span className="sr-only">Search notes</span>
                                <input
                                    className="search-input"
                                    type="search"
                                    placeholder="Search your notes or tags..."
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                />
                            </label>
                            <div className="notes-actions">
                                <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={() => setCalendarOpen(true)}
                                >
                                    <CalendarDays size={15} aria-hidden="true" />
                                    Calendar
                                </button>
                                <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={() => setEditingGlobalId(window.crypto.randomUUID())}
                                >
                                    <Plus size={15} aria-hidden="true" />
                                    Global note
                                </button>
                            </div>
                        </div>

                        {allTags.length > 0 && (
                            <div className="tag-filter-row" aria-label="Filter by tag">
                                <span className="tag-filter-label">TAGS</span>
                                {allTags.map((tag) => (
                                    <button
                                        key={tag.toLocaleLowerCase()}
                                        type="button"
                                        className="tag-filter"
                                        aria-pressed={selectedTag === tag}
                                        onClick={() => setSelectedTag((current) => (current === tag ? null : tag))}
                                    >
                                        {tag}
                                    </button>
                                ))}
                                {selectedTag && (
                                    <button className="text-button" type="button" onClick={() => setSelectedTag(null)}>
                                        Clear tag
                                    </button>
                                )}
                            </div>
                        )}

                        {renderGlobalSection(visibleGlobalNotes)}

                        {weeks.length > 0 ? (
                            weeks.map((week) => (
                                <NoteGroup
                                    key={week.weekStart}
                                    id={`week-${week.weekStart}`}
                                    title={`Week of ${formatEntryDate(week.weekStart)}`}
                                    count={week.entries.length}
                                    item="entry"
                                    defaultExpanded={week.weekStart === weekStart(today)}
                                >
                                    {week.entries.map((entry) => (
                                        <article key={entry.entryDate} className="idea-card journal-card">
                                            <div className="idea-card-top">
                                                <h4 className="journal-date">
                                                    <time dateTime={entry.entryDate}>
                                                        {formatEntryDate(entry.entryDate)}
                                                    </time>
                                                </h4>
                                                {entry.entryDate === today && <span className="card-label">Today</span>}
                                            </div>
                                            <p className="idea-body journal-body">{entry.body}</p>
                                            {entry.tags.length > 0 && (
                                                <div className="idea-tags">
                                                    {entry.tags.map((tag) => (
                                                        <button
                                                            key={tag.toLocaleLowerCase()}
                                                            className="tag-chip tag-filter"
                                                            type="button"
                                                            aria-label={`Filter by ${tag}`}
                                                            onClick={() => setSelectedTag(tag)}
                                                        >
                                                            <Tag size={10} aria-hidden="true" />
                                                            {tag}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="idea-card-bottom">
                                                <span className="idea-date">
                                                    <Clock3 size={12} aria-hidden="true" />
                                                    <time dateTime={entry.updatedAt}>
                                                        {formatIdeaTimestamp(entry.updatedAt)}
                                                    </time>
                                                </span>
                                                <button
                                                    type="button"
                                                    className="edit-button"
                                                    aria-label={`Edit entry for ${formatEntryDate(entry.entryDate)}`}
                                                    onClick={() => setEditingDate(entry.entryDate)}
                                                >
                                                    Edit
                                                </button>
                                            </div>
                                        </article>
                                    ))}
                                </NoteGroup>
                            ))
                        ) : !visibleHasContent ? (
                            <div className="empty-state">
                                <span className="empty-icon" aria-hidden="true">
                                    {filtering ? <Search size={21} /> : <NotebookPen size={22} />}
                                </span>
                                <h4>{filtering ? 'No notes match this search' : 'No notes yet'}</h4>
                                <p>
                                    {filtering
                                        ? 'Try another phrase or clear the tag filter.'
                                        : 'Write one entry a day. Notes are grouped by week, newest first.'}
                                </p>
                                {!filtering && (
                                    <button
                                        type="button"
                                        className="primary-button"
                                        onClick={() => setEditingDate(today)}
                                    >
                                        <CalendarPlus size={15} aria-hidden="true" />
                                        Write today&apos;s entry
                                    </button>
                                )}
                            </div>
                        ) : null}
                    </section>
                </div>
            )}

            {editingDate !== undefined && (
                <JournalDialog
                    key={editingDate}
                    entryDate={editingDate}
                    entry={editingEntry}
                    onClose={() => {
                        setCalendarSelection(false);
                        setEditingDate(undefined);
                    }}
                    fromCalendar={calendarSelection}
                    onSave={(body, tags) => journal.save(editingDate, body, tags)}
                    onDelete={() => journal.remove(editingDate)}
                    onDraftProtectionChange={onDraftProtectionChange}
                />
            )}
            {editingGlobalId !== undefined && (
                <GlobalNoteDialog
                    key={editingGlobalId}
                    note={globalNote}
                    id={editingGlobalId}
                    onClose={() => setEditingGlobalId(undefined)}
                    onSave={(note) =>
                        globalNotes.save({
                            id: note.id,
                            title: note.title,
                            body: note.body,
                            tags: note.tags,
                        })
                    }
                    onDelete={() => globalNotes.remove(editingGlobalId)}
                    onDraftProtectionChange={onDraftProtectionChange}
                />
            )}
            {calendarOpen && (
                <CalendarDialog
                    entries={entries.map((entry) => entry.entryDate)}
                    today={today}
                    onClose={() => setCalendarOpen(false)}
                    onSelect={(date) => {
                        setCalendarSelection(true);
                        setCalendarOpen(false);
                        setEditingDate(date);
                    }}
                />
            )}
        </>
    );
}
