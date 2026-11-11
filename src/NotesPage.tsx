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
import { journalEntryKey } from '../shared/journal';
import { categoryLabel, NoteCategories } from './NoteCategories';
import type { NoteFilter } from './NoteCategories';
import { formatIdeaTimestamp, parseTags } from './ideas';
import { filterEntries, formatEntryDate, groupByWeek, readNoteFilter, weekStart, writeNoteFilter } from './journal';
import type { JournalEntry } from './journal';
import { CalendarDialog } from './CalendarDialog';
import { NoteGroup } from './NoteGroup';
import type { GlobalNote } from './globalNotesSync';
import { PageLoading } from './Loading';
import { countNoteSections, MarkdownNoteBody, MarkdownNoteEditor } from './MarkdownNote';
import type { SectionCommand } from './MarkdownNote';
import { useTheme } from './ThemeContext';
import type { useJournalSync } from './useJournalSync';
import type { useGlobalNotesSync } from './useGlobalNotesSync';
import { useEditorDismissal } from './useEditorDismissal';
import { EditorSizeToggle, useEditorSize } from './EditorSize';
import { DialogCloseButton } from './DialogClose';
import { useSearchHighlight } from './searchHighlight';

interface JournalDialogProps {
    entryDate: string;
    entries: JournalEntry[];
    initialCategory: NoteCategory;
    onClose: () => void;
    onSave: (sections: { body: string; tags: string[]; category: NoteCategory }[]) => string | null;
    onDelete: (category: NoteCategory) => string | null;
    onDraftProtectionChange: (protectedDraft: boolean) => void;
    fromCalendar?: boolean;
}

function JournalDialog({
    entryDate,
    entries,
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
    const bodyRef = useRef<HTMLTextAreaElement>(null);
    const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const isAppleTouchDevice =
        /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const [formError, setFormError] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [confirmingEmpty, setConfirmingEmpty] = useState(false);
    const [category, setCategory] = useState<NoteCategory>(initialCategory);
    const [editorRevision, setEditorRevision] = useState(0);
    const entry = entries.find((value) => (value.category ?? null) === category);
    const [original, setOriginal] = useState<Record<string, { body: string; tags: string }>>(() =>
        Object.fromEntries(
            entries.map((value) => [
                value.category ?? 'unclassified',
                { body: value.body, tags: value.tags.join(', ') },
            ])
        )
    );
    const [drafts, setDrafts] = useState(original);
    const draft = drafts[category ?? 'unclassified'] ?? { body: '', tags: '' };
    const dismissal = useEditorDismissal(
        dialogRef,
        entries.some((value) => Boolean(value.body.trim())),
        onDraftProtectionChange
    );
    const captureDraft = () => {
        if (!formRef.current) return drafts;
        const formData = new FormData(formRef.current);
        const next = {
            ...drafts,
            [category ?? 'unclassified']: {
                body: String(formData.get('body') ?? ''),
                tags: String(formData.get('tags') ?? ''),
            },
        };
        setDrafts(next);
        return next;
    };
    const editedSections = (values = drafts, baseline = original) =>
        Object.entries(values).filter(
            ([section, value]) =>
                value.body !== (baseline[section]?.body ?? '') || value.tags !== (baseline[section]?.tags ?? '')
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
        const edited = editedSections(captureDraft());
        const tagsWithoutDetails = edited.find(
            ([section, value]) => !value.body.trim() && value.tags.trim() && !original[section]?.body.trim()
        );
        if (tagsWithoutDetails) {
            const label =
                tagsWithoutDetails[0] === 'unclassified'
                    ? 'Unclassified'
                    : categoryLabel(tagsWithoutDetails[0] === 'home' ? 'home' : 'work');
            setFormError(`Write details for ${label} before saving its tags.`);
            return;
        }
        const hasContent = edited.some(([, value]) => value.body.trim());
        const deletesEntry = edited.some(([section, value]) => !value.body.trim() && original[section]?.body.trim());
        if (!hasContent && !deletesEntry && !entry) {
            setFormError('Write something before saving this entry.');
            bodyRef.current?.focus();
            return;
        }
        if (deletesEntry) {
            if (!confirmingEmpty) {
                setConfirmingEmpty(true);
                setFormError('A saved section is empty. Save again to delete that section.');
                return;
            }
        }
        finish(
            onSave(
                edited
                    .filter(([section, value]) => value.body.trim() || original[section]?.body.trim())
                    .map(([section, value]) => ({
                        category: section === 'unclassified' ? null : section === 'home' ? 'home' : 'work',
                        body: value.body.trim(),
                        tags: parseTags(value.tags, journalLimits.tags),
                    }))
            )
        );
    };

    const handleDelete = () => {
        if (!confirmingDelete) {
            setConfirmingDelete(true);
            return;
        }
        const nextDrafts = captureDraft();
        const error = onDelete(category);
        if (error) {
            setFormError(error);
            return;
        }
        const section = category ?? 'unclassified';
        const remainingDrafts = { ...nextDrafts };
        const remainingOriginal = { ...original };
        delete remainingDrafts[section];
        delete remainingOriginal[section];
        setDrafts(remainingDrafts);
        setOriginal(remainingOriginal);
        if (editedSections(remainingDrafts, remainingOriginal).length === 0) onClose();
        else {
            setConfirmingDelete(false);
            setEditorRevision((value) => value + 1);
        }
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
                    const next = captureDraft();
                    dismissal.setProtectedDraft(
                        Object.values(next).some((value) => Boolean(value.body.trim() || value.tags.trim()))
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
                        <h2 id="journal-dialog-title">Entry for {formatEntryDate(entryDate)}</h2>
                    </div>
                </div>
                <div className="field-group">
                    <span className="field-label">Section</span>
                    <NoteCategories
                        value={category ?? 'unclassified'}
                        onChange={(value) => {
                            if (value === 'all') return;
                            const next = captureDraft();
                            dismissal.setProtectedDraft(
                                Object.values(next).some((draft) => Boolean(draft.body.trim() || draft.tags.trim()))
                            );
                            setCategory(value === 'unclassified' ? null : value);
                            setFormError(null);
                            setConfirmingDelete(false);
                            setConfirmingEmpty(false);
                        }}
                    />
                </div>
                <MarkdownNoteEditor
                    key={`body-${category}-${editorRevision}`}
                    label="Details"
                    bodyRef={bodyRef}
                    name="body"
                    maxLength={journalLimits.body}
                    defaultValue={draft.body}
                    onChange={() => setConfirmingEmpty(false)}
                />
                <label className="field-group">
                    <span className="field-label">Tags</span>
                    <input
                        key={`tags-${category}-${editorRevision}`}
                        className="field-input"
                        name="tags"
                        type="text"
                        maxLength={2000}
                        defaultValue={draft.tags}
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
    const workspaceRef = useRef<HTMLElement>(null);
    useSearchHighlight(workspaceRef, query, '.idea-card');
    const [categoryFilter, setCategoryFilter] = useState<NoteFilter>(readNoteFilter);
    const newCategory: NoteCategory =
        categoryFilter === 'unclassified' ? null : categoryFilter === 'work' ? 'work' : 'home';
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [calendarSelection, setCalendarSelection] = useState(false);
    const [editingGlobalId, setEditingGlobalId] = useState<string | undefined>();
    const [editingCategory, setEditingCategory] = useState<NoteCategory | undefined>();
    const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
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
    const editingEntries = entries.filter((entry) => entry.entryDate === editingDate);
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
                                    item="entry"
                                    defaultExpanded={week.weekStart === weekStart(today)}
                                >
                                    {week.entries.map((entry) => {
                                        const key = journalEntryKey(entry.entryDate, entry.category);
                                        const expanded = expandedDays[key] ?? entry.entryDate === today;
                                        const sectionCommand = sectionCommands[key] ?? SECTIONS_COLLAPSED;
                                        const sectionsExpanded = sectionCommand.expanded;
                                        const dateLabel = formatEntryDate(entry.entryDate);
                                        return (
                                            <article key={key} className="idea-card journal-card">
                                                <div className="journal-card-head">
                                                    <h4 className="journal-date">
                                                        <button
                                                            type="button"
                                                            className="journal-day-toggle idea-card-top"
                                                            aria-label={`Daily note for ${dateLabel}`}
                                                            aria-expanded={expanded}
                                                            aria-controls={`day-${key}-details`}
                                                            onClick={() =>
                                                                setExpandedDays((days) => ({
                                                                    ...days,
                                                                    [key]: !expanded,
                                                                }))
                                                            }
                                                        >
                                                            <span className="note-group-label">
                                                                {expanded ? (
                                                                    <ChevronDown size={16} aria-hidden="true" />
                                                                ) : (
                                                                    <ChevronRight size={16} aria-hidden="true" />
                                                                )}
                                                                <time dateTime={entry.entryDate}>{dateLabel}</time>
                                                            </span>
                                                        </button>
                                                    </h4>
                                                    {expanded && countNoteSections(entry.body) > 1 && (
                                                        <SectionsPill
                                                            label={`Sections for ${dateLabel}`}
                                                            expanded={sectionsExpanded}
                                                            onChange={(next) =>
                                                                setSectionCommands((commands) => ({
                                                                    ...commands,
                                                                    [key]: {
                                                                        expanded: next,
                                                                        seq: (commands[key]?.seq ?? 0) + 1,
                                                                    },
                                                                }))
                                                            }
                                                        />
                                                    )}
                                                    <span className="card-label">{categoryLabel(entry.category)}</span>
                                                    {entry.entryDate === today && (
                                                        <span className="card-label">Today</span>
                                                    )}
                                                </div>
                                                <div id={`day-${key}-details`} hidden={!expanded}>
                                                    <MarkdownNoteBody
                                                        body={entry.body}
                                                        className="idea-body journal-body markdown-body"
                                                        sectionCommand={sectionCommand}
                                                        onBodyChange={(body) =>
                                                            journal.save(
                                                                entry.entryDate,
                                                                body,
                                                                entry.tags,
                                                                entry.category
                                                            )
                                                        }
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
                                                            onClick={() => {
                                                                setEditingCategory(entry.category ?? null);
                                                                setEditingDate(entry.entryDate);
                                                            }}
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
                    entries={editingEntries}
                    initialCategory={editingCategory === undefined ? newCategory : editingCategory}
                    onClose={() => {
                        setCalendarSelection(false);
                        setEditingCategory(undefined);
                        setEditingDate(undefined);
                    }}
                    fromCalendar={calendarSelection}
                    onSave={(sections) => journal.saveSections(editingDate, sections)}
                    onDelete={(category) => journal.remove(editingDate, category)}
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
