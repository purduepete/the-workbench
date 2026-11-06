import { useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
    CalendarDays,
    Check,
    ChevronDown,
    ChevronRight,
    Clock3,
    NotebookPen,
    Plus,
    Search,
    Tag,
    Trash2,
    X,
} from 'lucide-react';
import { globalNoteLimits, journalLimits } from '../shared/contracts';
import type { NoteCategory } from '../shared/contracts';
import { categoryLabel, NoteCategories } from './NoteCategories';
import type { NoteFilter } from './NoteCategories';
import { formatIdeaTimestamp, parseTags } from './ideas';
import { filterEntries, formatEntryDate, groupByWeek, readNoteFilter, weekStart, writeNoteFilter } from './journal';
import type { JournalEntry } from './journal';
import { CalendarDialog } from './CalendarDialog';
import { NoteGroup } from './NoteGroup';
import type { GlobalNote } from './globalNotesSync';
import { PageLoading } from './Loading';
import { MarkdownNoteBody, MarkdownNoteEditor } from './MarkdownNote';
import { useTheme } from './ThemeContext';
import type { useJournalSync } from './useJournalSync';
import type { useGlobalNotesSync } from './useGlobalNotesSync';
import { useEditorDismissal } from './useEditorDismissal';

interface JournalDialogProps {
    entryDate: string;
    entry: JournalEntry | undefined;
    initialCategory: NoteCategory;
    onClose: () => void;
    onSave: (body: string, tags: string[], category: NoteCategory) => string | null;
    onDelete: () => string | null;
    onDraftProtectionChange: (protectedDraft: boolean) => void;
    fromCalendar?: boolean;
}

function JournalDialog({
    entryDate,
    entry,
    initialCategory,
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
    const [category, setCategory] = useState<NoteCategory>(entry ? (entry.category ?? null) : initialCategory);
    const dismissal = useEditorDismissal(dialogRef, Boolean(entry?.body.trim()), onDraftProtectionChange);

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const returnFocus = returnFocusRef.current;
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
        finish(onSave(body, parseTags(String(formData.get('tags') ?? ''), journalLimits.tags), category));
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
                        <p className="eyebrow">Daily note</p>
                        <h2 id="journal-dialog-title">Entry for {formatEntryDate(entryDate)}</h2>
                    </div>
                </div>
                <div className="field-group">
                    <span className="field-label">Section</span>
                    <NoteCategories
                        value={category ?? 'unclassified'}
                        onChange={(value) => {
                            if (value === 'all') return;
                            setCategory(value === 'unclassified' ? null : value);
                            dismissal.setProtectedDraft(true);
                        }}
                    />
                </div>
                <MarkdownNoteEditor
                    label="Details"
                    bodyRef={bodyRef}
                    name="body"
                    maxLength={journalLimits.body}
                    defaultValue={entry?.body ?? ''}
                    onChange={() => setConfirmingEmpty(false)}
                />
                <label className="field-group">
                    <span className="field-label">Tags</span>
                    <input
                        className="field-input"
                        name="tags"
                        type="text"
                        maxLength={2000}
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
    const bodyRef = useRef<HTMLTextAreaElement>(null);
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
                        required
                    />
                </label>
                <MarkdownNoteEditor
                    label="Details"
                    bodyRef={bodyRef}
                    name="body"
                    maxLength={globalNoteLimits.body}
                    defaultValue={note?.body ?? ''}
                />
                <label className="field-group">
                    <span className="field-label">Tags</span>
                    <input
                        className="field-input"
                        name="tags"
                        type="text"
                        maxLength={2000}
                        defaultValue={note?.tags.join(', ') ?? ''}
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
    const [filterNotice, setFilterNotice] = useState<string | null>(null);
    const notice = journal.notice ?? globalNotes.notice ?? filterNotice;
    const clearNotice = () => {
        journal.clearNotice();
        globalNotes.clearNotice();
        setFilterNotice(null);
    };
    const [query, setQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<NoteFilter>(readNoteFilter);
    const newCategory: NoteCategory =
        categoryFilter === 'unclassified' ? null : categoryFilter === 'work' ? 'work' : 'home';
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [calendarSelection, setCalendarSelection] = useState(false);
    const [editingGlobalId, setEditingGlobalId] = useState<string | undefined>();
    const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
    const { entries } = journal;
    const matchesCategory = (category: NoteCategory | undefined) =>
        categoryFilter === 'all' ||
        (categoryFilter === 'unclassified' ? category == null : category === categoryFilter);
    const categoryEntries = entries.filter((entry) => matchesCategory(entry.category));
    const visible = filterEntries(categoryEntries, query, selectedTag);
    const weeks = groupByWeek(visible);
    const filtering = Boolean(query || selectedTag || categoryFilter !== 'all');
    const allTags = Array.from(
        new Set([...categoryEntries.flatMap((entry) => entry.tags), ...globalNotes.notes.flatMap((note) => note.tags)])
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
                        <MarkdownNoteBody
                            body={note.body || 'No body text.'}
                            className="idea-body journal-body markdown-body"
                        />
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
                            <div className="notes-toolbar-actions">
                                <NoteCategories
                                    value={categoryFilter}
                                    filter
                                    onChange={(value) => {
                                        setCategoryFilter(value);
                                        setFilterNotice(writeNoteFilter(value));
                                        setSelectedTag(null);
                                    }}
                                />
                                <div className="notes-actions">
                                    <button
                                        type="button"
                                        className="secondary-button"
                                        onClick={() => setEditingGlobalId(window.crypto.randomUUID())}
                                    >
                                        <Plus size={15} aria-hidden="true" />
                                        Global note
                                    </button>
                                    <button
                                        type="button"
                                        className="secondary-button"
                                        onClick={() => setCalendarOpen(true)}
                                    >
                                        <CalendarDays size={15} aria-hidden="true" />
                                        Calendar
                                    </button>
                                </div>
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
                                    {week.entries.map((entry) => {
                                        const expanded = expandedDays[entry.entryDate] ?? entry.entryDate === today;
                                        return (
                                            <article key={entry.entryDate} className="idea-card journal-card">
                                                <h4 className="journal-date">
                                                    <button
                                                        type="button"
                                                        className="journal-day-toggle idea-card-top"
                                                        aria-label={`Daily note for ${formatEntryDate(entry.entryDate)}`}
                                                        aria-expanded={expanded}
                                                        aria-controls={`day-${entry.entryDate}-details`}
                                                        onClick={() =>
                                                            setExpandedDays((days) => ({
                                                                ...days,
                                                                [entry.entryDate]: !expanded,
                                                            }))
                                                        }
                                                    >
                                                        <span className="note-group-label">
                                                            {expanded ? (
                                                                <ChevronDown size={16} aria-hidden="true" />
                                                            ) : (
                                                                <ChevronRight size={16} aria-hidden="true" />
                                                            )}
                                                            <time dateTime={entry.entryDate}>
                                                                {formatEntryDate(entry.entryDate)}
                                                            </time>
                                                        </span>
                                                        <span className="card-label">
                                                            {categoryLabel(entry.category)}
                                                        </span>
                                                        {entry.entryDate === today && (
                                                            <span className="card-label">Today</span>
                                                        )}
                                                    </button>
                                                </h4>
                                                <div id={`day-${entry.entryDate}-details`} hidden={!expanded}>
                                                    <MarkdownNoteBody
                                                        body={entry.body}
                                                        className="idea-body journal-body markdown-body"
                                                    />
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
                                                </div>
                                            </article>
                                        );
                                    })}
                                </NoteGroup>
                            ))
                        ) : !visibleHasContent ? (
                            <div className="empty-state">
                                <span className="empty-icon" aria-hidden="true">
                                    {filtering ? <Search size={21} /> : <NotebookPen size={22} />}
                                </span>
                                <h4>{filtering ? 'No notes match this search' : 'No notes yet'}</h4>
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
                    initialCategory={newCategory}
                    onClose={() => {
                        setCalendarSelection(false);
                        setEditingDate(undefined);
                    }}
                    fromCalendar={calendarSelection}
                    onSave={(body, tags, category) => journal.save(editingDate, body, tags, category)}
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
                    entries={categoryEntries.map((entry) => entry.entryDate)}
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
