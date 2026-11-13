import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import {
    CalendarDays,
    Check,
    ChevronDown,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
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
import {
    filterEntries,
    formatEntryDate,
    groupByWeek,
    noteHeading,
    readNoteFilter,
    weekStart,
    writeNoteFilter,
} from './journal';
import type { JournalEntry } from './journal';
import { CalendarDialog } from './CalendarDialog';
import { NoteGroup } from './NoteGroup';
import type { GlobalNote } from './globalNotesSync';
import { PageLoading } from './Loading';
import { countNoteSections, MarkdownNoteBody, MarkdownNoteEditor } from './MarkdownNote';
import type { SectionCommand } from './MarkdownNote';
import { useTheme } from './ThemeContext';
import type { useJournalSync } from './useJournalSync';
import type { JournalNoteInput } from './journalSync';
import type { useGlobalNotesSync } from './useGlobalNotesSync';
import { useEditorDismissal } from './useEditorDismissal';
import { EditorSizeToggle, useEditorSize } from './EditorSize';
import { DialogCloseButton } from './DialogClose';
import { useSearchHighlight } from './searchHighlight';

interface JournalDialogProps {
    id: string;
    entryDate: string;
    note: JournalEntry | undefined;
    initialCategory: NoteCategory;
    onClose: () => void;
    onSave: (note: JournalNoteInput) => string | null;
    onDelete: () => string | null;
    onDraftProtectionChange: (protectedDraft: boolean) => void;
    fromCalendar?: boolean;
}

/** Edits one daily note. A day can hold any number of them. */
function JournalDialog({
    id,
    entryDate,
    note,
    initialCategory,
    onClose,
    onSave,
    onDelete,
    onDraftProtectionChange,
    fromCalendar = false,
}: JournalDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const editorSize = useEditorSize();
    const formRef = useRef<HTMLFormElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);
    const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const isAppleTouchDevice =
        /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const [formError, setFormError] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [confirmingEmpty, setConfirmingEmpty] = useState(false);
    const [category, setCategory] = useState<NoteCategory>(note ? (note.category ?? null) : initialCategory);
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
        const title = String(formData.get('title') ?? '').trim();
        const body = String(formData.get('body') ?? '').trim();
        const tags = String(formData.get('tags') ?? '');
        if (!body) {
            if (!note) {
                setFormError(
                    title || tags.trim()
                        ? 'Write details before saving this note.'
                        : 'Write something before saving this note.'
                );
                bodyRef.current?.focus();
                return;
            }
            if (!confirmingEmpty) {
                setConfirmingEmpty(true);
                setFormError('This note has no details. Save again to delete it.');
                return;
            }
            finish(onDelete());
            return;
        }
        finish(onSave({ id, entryDate, title, body, tags: parseTags(tags, journalLimits.tags), category }));
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
            data-maximized={editorSize.maximized}
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
                    const data = new FormData(form);
                    setConfirmingEmpty(false);
                    dismissal.setProtectedDraft(
                        ['title', 'body', 'tags'].some((field) => String(data.get(field) ?? '').trim())
                    );
                }}
            >
                <div className="dialog-corner-actions">
                    <EditorSizeToggle maximized={editorSize.maximized} onToggle={editorSize.toggle} />
                    <DialogCloseButton onClose={onClose} isProtected={dismissal.isProtected} />
                </div>
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Daily note</p>
                        <h2 id="journal-dialog-title">
                            {note ? 'Edit note' : 'New note'} for {formatEntryDate(entryDate)}
                        </h2>
                    </div>
                </div>
                <div className="journal-meta-row">
                    <div className="field-group">
                        <span className="field-label">Section</span>
                        <NoteCategories
                            value={category ?? 'unclassified'}
                            onChange={(value) => {
                                if (value === 'all') return;
                                setCategory(value === 'unclassified' ? null : value);
                                setFormError(null);
                            }}
                        />
                    </div>
                    <label className="field-group journal-title-field">
                        <span className="field-label">Title (optional)</span>
                        <input
                            ref={titleRef}
                            className="field-input"
                            name="title"
                            type="text"
                            maxLength={journalLimits.title}
                            defaultValue={note?.title ?? ''}
                        />
                    </label>
                </div>
                <MarkdownNoteEditor
                    label="Details"
                    bodyRef={bodyRef}
                    name="body"
                    maxLength={journalLimits.body}
                    defaultValue={note?.body ?? ''}
                    onChange={() => setConfirmingEmpty(false)}
                />
                <label className="field-group">
                    <span className="field-label">Tags</span>
                    <input
                        className="field-input"
                        name="tags"
                        type="text"
                        maxLength={2000}
                        defaultValue={note?.tags.join(', ') ?? ''}
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
                    {note && (
                        <button
                            type="button"
                            className="danger-button"
                            data-confirming={confirmingDelete}
                            aria-label={confirmingDelete ? 'Confirm delete' : 'Delete note'}
                            onClick={handleDelete}
                            onBlur={() => setConfirmingDelete(false)}
                        >
                            <Trash2 size={15} aria-hidden="true" />
                            {confirmingDelete ? 'Confirm' : 'Delete'}
                        </button>
                    )}
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
    const editorSize = useEditorSize();
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
            data-maximized={editorSize.maximized}
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
                <div className="dialog-corner-actions">
                    <EditorSizeToggle maximized={editorSize.maximized} onToggle={editorSize.toggle} />
                    <DialogCloseButton onClose={onClose} isProtected={dismissal.isProtected} />
                </div>
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
                    <button type="submit" className="primary-button">
                        <Check size={15} aria-hidden="true" />
                        Save note
                    </button>
                </div>
            </form>
        </dialog>
    );
}

/** The daily note being edited. A new note has an id with no saved entry yet. */
export interface JournalEditTarget {
    id: string;
    entryDate: string;
}

export interface NotesPageProps {
    journal: ReturnType<typeof useJournalSync>;
    globalNotes: ReturnType<typeof useGlobalNotesSync>;
    ready: boolean;
    syncBadge: ReactNode;
    today: string;
    editingNote: JournalEditTarget | undefined;
    setEditingNote: (target: JournalEditTarget | undefined) => void;
    onDraftProtectionChange: (protectedDraft: boolean) => void;
}

/** Daily note sections start collapsed until the pill or a section heading opens them. */
const SECTIONS_COLLAPSED: SectionCommand = { expanded: false, seq: 0 };

/** Two-option rounded pill that expands or collapses every section of one daily note. */
function SectionsPill({
    label,
    expanded,
    onChange,
}: {
    label: string;
    expanded: boolean;
    onChange: (expanded: boolean) => void;
}) {
    const style = { '--segment-index': expanded ? 0 : 1, '--segment-count': 2 } as CSSProperties;
    return (
        <div className="segmented sections-pill" role="group" aria-label={label} style={style}>
            <span className="segment-fill" aria-hidden="true" />
            <button
                type="button"
                className="segment-button"
                aria-label="Expand all sections"
                aria-pressed={expanded}
                onClick={() => onChange(true)}
            >
                <ChevronsUpDown size={10} aria-hidden="true" />
            </button>
            <button
                type="button"
                className="segment-button"
                aria-label="Collapse all sections"
                aria-pressed={!expanded}
                onClick={() => onChange(false)}
            >
                <ChevronsDownUp size={10} aria-hidden="true" />
            </button>
        </div>
    );
}

export function NotesPage({
    journal,
    globalNotes,
    ready,
    syncBadge,
    today,
    editingNote,
    setEditingNote,
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
    const workspaceRef = useRef<HTMLElement>(null);
    useSearchHighlight(workspaceRef, query, '.idea-card');
    const [categoryFilter, setCategoryFilter] = useState<NoteFilter>(readNoteFilter);
    const newCategory: NoteCategory =
        categoryFilter === 'unclassified' ? null : categoryFilter === 'work' ? 'work' : 'home';
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [calendarSelection, setCalendarSelection] = useState(false);
    const [editingGlobalId, setEditingGlobalId] = useState<string | undefined>();
    const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
    const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});
    const dayRefs = useRef(new Map<string, HTMLElement>());
    const [sectionCommands, setSectionCommands] = useState<Record<string, SectionCommand>>({});
    const { entries } = journal;
    const matchesCategory = (category: NoteCategory | undefined) =>
        categoryFilter === 'all' ||
        (categoryFilter === 'unclassified' ? category == null : category === categoryFilter);
    const categoryEntries = entries.filter((entry) => matchesCategory(entry.category));
    const visible = filterEntries(categoryEntries, query, selectedTag);
    const weeks = groupByWeek(visible);
    const filtering = Boolean(query || selectedTag || categoryFilter !== 'all');
    const allTags = Array.from(
        new Set([
            ...categoryEntries.flatMap((entry) => entry.tags),
            ...(categoryFilter === 'all' ? globalNotes.notes.flatMap((note) => note.tags) : []),
        ])
    ).sort((a, b) => a.localeCompare(b));
    const editingEntry = editingNote && entries.find((entry) => entry.id === editingNote.id);
    const openNewNote = (entryDate: string) => setEditingNote({ id: window.crypto.randomUUID(), entryDate });
    const globalNote = globalNotes.notes.find((note) => note.id === editingGlobalId);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const visibleGlobalNotes = (categoryFilter === 'all' ? globalNotes.notes : []).filter(
        (note) =>
            (!selectedTag || note.tags.some((tag) => tag.toLocaleLowerCase() === selectedTag.toLocaleLowerCase())) &&
            (!normalizedQuery ||
                note.title.toLocaleLowerCase().includes(normalizedQuery) ||
                note.body.toLocaleLowerCase().includes(normalizedQuery) ||
                note.tags.some((tag) => tag.toLocaleLowerCase().includes(normalizedQuery)))
    );
    const visibleHasContent = weeks.length > 0 || visibleGlobalNotes.length > 0;

    const renderNote = (entry: JournalEntry) => {
        const key = entry.id;
        const heading = noteHeading(entry);
        const expanded = expandedNotes[key] ?? entry.entryDate === today;
        const sectionCommand = sectionCommands[key] ?? SECTIONS_COLLAPSED;
        return (
            <article key={key} className="idea-card journal-card">
                <div className="journal-card-head">
                    <h5 className="journal-date">
                        <button
                            type="button"
                            className="journal-day-toggle idea-card-top"
                            aria-label={heading}
                            aria-expanded={expanded}
                            aria-controls={`note-${key}-details`}
                            onClick={() => setExpandedNotes((notes) => ({ ...notes, [key]: !expanded }))}
                        >
                            <span className="note-group-label">
                                {expanded ? (
                                    <ChevronDown size={16} aria-hidden="true" />
                                ) : (
                                    <ChevronRight size={16} aria-hidden="true" />
                                )}
                                <span className="journal-note-title">{heading}</span>
                            </span>
                        </button>
                    </h5>
                    {expanded && countNoteSections(entry.body) > 1 && (
                        <SectionsPill
                            label={`Sections for ${heading}`}
                            expanded={sectionCommand.expanded}
                            onChange={(next) =>
                                setSectionCommands((commands) => ({
                                    ...commands,
                                    [key]: { expanded: next, seq: (commands[key]?.seq ?? 0) + 1 },
                                }))
                            }
                        />
                    )}
                    <span className="card-label">{categoryLabel(entry.category)}</span>
                </div>
                <div id={`note-${key}-details`} hidden={!expanded}>
                    <MarkdownNoteBody
                        body={entry.body}
                        className="idea-body journal-body markdown-body"
                        sectionCommand={sectionCommand}
                        onBodyChange={(body) => journal.save({ ...entry, category: entry.category ?? null, body })}
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
                            <time dateTime={entry.updatedAt}>{formatIdeaTimestamp(entry.updatedAt)}</time>
                        </span>
                        <button
                            type="button"
                            className="edit-button"
                            aria-label={`Edit ${heading}`}
                            onClick={() => setEditingNote({ id: entry.id, entryDate: entry.entryDate })}
                        >
                            Edit
                        </button>
                    </div>
                </div>
            </article>
        );
    };
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
                            onBodyChange={(body) =>
                                globalNotes.save({ id: note.id, title: note.title, body, tags: note.tags })
                            }
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

                    <section ref={workspaceRef} className="workspace" aria-label="Your notes">
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
                                    item="note"
                                    expanded={expandedWeeks[week.weekStart] ?? week.weekStart === weekStart(today)}
                                    onExpandedChange={(expanded) =>
                                        setExpandedWeeks((current) => ({ ...current, [week.weekStart]: expanded }))
                                    }
                                >
                                    {week.days.map((day) => {
                                        const dateLabel = formatEntryDate(day.entryDate);
                                        return (
                                            <section
                                                key={day.entryDate}
                                                className="journal-day"
                                                aria-label={`Notes for ${dateLabel}`}
                                                ref={(element) => {
                                                    if (element) dayRefs.current.set(day.entryDate, element);
                                                    else dayRefs.current.delete(day.entryDate);
                                                }}
                                            >
                                                <div className="journal-day-heading">
                                                    <h4>
                                                        <time dateTime={day.entryDate}>{dateLabel}</time>
                                                    </h4>
                                                    {day.entryDate === today && (
                                                        <span className="card-label">Today</span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="icon-button journal-day-add"
                                                        aria-label={`Add a note for ${dateLabel}`}
                                                        onClick={() => openNewNote(day.entryDate)}
                                                    >
                                                        <Plus size={14} aria-hidden="true" />
                                                    </button>
                                                </div>
                                                {day.entries.map((entry) => renderNote(entry))}
                                            </section>
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

            {editingNote !== undefined && (
                <JournalDialog
                    key={editingNote.id}
                    id={editingNote.id}
                    entryDate={editingEntry?.entryDate ?? editingNote.entryDate}
                    note={editingEntry}
                    initialCategory={newCategory}
                    onClose={() => {
                        setCalendarSelection(false);
                        setEditingNote(undefined);
                    }}
                    fromCalendar={calendarSelection}
                    onSave={(note) => journal.save(note)}
                    onDelete={() => journal.remove(editingNote.id, editingEntry?.entryDate ?? editingNote.entryDate)}
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
                        setCalendarOpen(false);
                        if (!categoryEntries.some((entry) => entry.entryDate === date)) {
                            setCalendarSelection(true);
                            openNewNote(date);
                            return;
                        }
                        setQuery('');
                        setSelectedTag(null);
                        setExpandedWeeks((current) => ({ ...current, [weekStart(date)]: true }));
                        requestAnimationFrame(() =>
                            dayRefs.current.get(date)?.scrollIntoView({
                                block: 'start',
                                behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
                            })
                        );
                    }}
                />
            )}
        </>
    );
}
