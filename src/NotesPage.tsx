import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import {
    Check,
    ChevronDown,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    Clock3,
    Layers,
    NotebookPen,
    Pencil,
    Plus,
    Search,
    Tag,
    Trash2,
    X,
} from 'lucide-react';
import { globalNoteLimits, journalLimits } from '../shared/contracts';
import type { NoteCategory } from '../shared/contracts';
import { kindOf, NoteCategories } from './NoteCategories';
import type { NoteFilter, NoteKind } from './NoteCategories';
import { formatIdeaTimestamp, parseTags } from './ideas';
import {
    filterEntries,
    formatEntryDate,
    groupRecentWeeks,
    noteGroupKey,
    noteHeading,
    readNoteFilter,
    weekStart,
    writeNoteFilter,
} from './journal';
import type { JournalEntry } from './journal';
import { DateField } from './CalendarDialog';
import { SelectField } from './SelectField';
import { NoteGroup } from './NoteGroup';
import type { GlobalNote } from './globalNotesSync';
import { PageLoading } from './Loading';
import { countNoteSections, MarkdownNoteBody, MarkdownNoteEditor } from './MarkdownNote';
import type { SectionCommand } from './MarkdownNote';
import { useTheme } from './ThemeContext';
import type { useJournalSync } from './useJournalSync';
import type { useGlobalNotesSync } from './useGlobalNotesSync';
import type { useCommentsSync } from './useCommentsSync';
import { CommentaryAside, DetachedCommentary } from './NoteComments';
import { commentaryId, sectionKey, sectionKeys, WHOLE_NOTE } from './commentary';
import { formEdited, useEditorDismissal } from './useEditorDismissal';
import { EditorSizeToggle, useEditorSize } from './EditorSize';
import { DialogCloseButton } from './DialogClose';
import { useSearchHighlight } from './searchHighlight';

/** A note as the editor sees it, whichever kind it is. */
interface EditableNote {
    title: string;
    body: string;
    tags: string[];
    kind: NoteKind;
}

export interface NoteSaveInput {
    kind: NoteKind;
    title: string;
    body: string;
    tags: string[];
    /** The day a new Home or Work note is saved under. */
    entryDate: string;
}

interface NoteDialogProps {
    /** The date a Home or Work note gets; a Global note has none. */
    entryDate: string;
    note: EditableNote | undefined;
    initialKind: NoteKind;
    onClose: () => void;
    onSave: (note: NoteSaveInput) => string | null;
    onDelete: () => string | null;
    onDraftProtectionChange: (protectedDraft: boolean) => void;
}

const titleLimit = Math.min(journalLimits.title, globalNoteLimits.title);
const noteKindOptions = [
    { value: 'global', label: 'Global' },
    { value: 'home', label: 'Home' },
    { value: 'work', label: 'Work' },
];

/** Edits one note. Home and Work notes belong to a day; switching to Global removes the date. */
function NoteDialog({
    entryDate: initialEntryDate,
    note,
    initialKind,
    onClose,
    onSave,
    onDelete,
    onDraftProtectionChange,
}: NoteDialogProps) {
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
    const [kind, setKind] = useState<NoteKind>(note?.kind ?? initialKind);
    // A new dated note can be filed under any day; a saved note keeps its date.
    const [entryDate, setEntryDate] = useState(initialEntryDate);
    const dismissal = useEditorDismissal(dialogRef, false, onDraftProtectionChange);

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
        let title = String(formData.get('title') ?? '').trim();
        const body = String(formData.get('body') ?? '').trim();
        const tags = parseTags(String(formData.get('tags') ?? ''), journalLimits.tags);
        // A Global note may be only a title; a dated note needs details.
        const empty = kind === 'global' ? !body && !title : !body;
        if (empty) {
            if (!note) {
                setFormError(
                    title || tags.length > 0
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
        // Global notes are listed by title; without one, the first line becomes the title.
        if (kind === 'global' && !title) title = noteHeading({ title: '', body }).slice(0, titleLimit);
        finish(onSave({ kind, title, body, tags, entryDate }));
    };

    const handleDelete = () => {
        if (!confirmingDelete) {
            setConfirmingDelete(true);
            return;
        }
        finish(onDelete());
    };

    const verb = note ? 'Edit note' : 'New note';
    return (
        <dialog
            ref={dialogRef}
            className="dialog-backdrop editor-dialog"
            data-maximized={editorSize.maximized}
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
                    setConfirmingEmpty(false);
                    dismissal.setProtectedDraft(formEdited(form));
                }}
            >
                <div className="dialog-corner-actions">
                    <EditorSizeToggle maximized={editorSize.maximized} onToggle={editorSize.toggle} />
                    <DialogCloseButton onClose={onClose} isProtected={dismissal.isProtected} />
                </div>
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Note</p>
                        <h2 id="journal-dialog-title">{verb}</h2>
                    </div>
                </div>
                <label className="sr-only" htmlFor="journal-title-input">
                    Title
                </label>
                <input
                    id="journal-title-input"
                    ref={titleRef}
                    className="editor-title-input"
                    name="title"
                    type="text"
                    placeholder="Title"
                    maxLength={titleLimit}
                    defaultValue={note?.title ?? ''}
                />
                <div className="editor-chips">
                    <SelectField
                        ariaLabel="Section"
                        icon={Layers}
                        className="chip-select"
                        value={kind}
                        options={noteKindOptions}
                        onChange={(value) => {
                            setKind(value as NoteKind);
                            setFormError(null);
                        }}
                    />
                    {kind !== 'global' && (
                        <DateField
                            label="Date"
                            value={entryDate}
                            // A saved daily note keeps its date; a new note, or a Global note becoming daily, picks one.
                            onChange={note && note.kind !== 'global' ? undefined : setEntryDate}
                        />
                    )}
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
    comments: ReturnType<typeof useCommentsSync>;
    ready: boolean;
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
    comments,
    ready,
    today,
    editingNote,
    setEditingNote,
    onDraftProtectionChange,
}: NotesPageProps) {
    const { storageWarning: themeStorageWarning } = useTheme();
    const [filterNotice, setFilterNotice] = useState<string | null>(null);
    const notice = journal.notice ?? globalNotes.notice ?? comments.notice ?? filterNotice;
    const clearNotice = () => {
        journal.clearNotice();
        globalNotes.clearNotice();
        comments.clearNotice();
        setFilterNotice(null);
    };
    const [query, setQuery] = useState('');
    const workspaceRef = useRef<HTMLElement>(null);
    useSearchHighlight(workspaceRef, query, '.idea-card');
    const [categoryFilter, setCategoryFilter] = useState<NoteFilter>(readNoteFilter);
    const newKind: NoteKind = categoryFilter;
    // Notes added from a day's + button belong to that day.
    const [datedNew, setDatedNew] = useState(false);
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
    const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});
    const [sectionCommands, setSectionCommands] = useState<Record<string, SectionCommand>>({});
    const { entries } = journal;
    const showGlobal = categoryFilter === 'global';
    const matchesCategory = (category: NoteCategory | undefined) =>
        categoryFilter !== 'global' && kindOf(category) === categoryFilter;
    const categoryEntries = entries.filter((entry) => matchesCategory(entry.category));
    const visible = filterEntries(categoryEntries, query, selectedTag);
    const weeks = groupRecentWeeks(visible, today);
    const filtering = Boolean(query || selectedTag);
    const allTags = Array.from(
        new Set([
            ...categoryEntries.flatMap((entry) => entry.tags),
            ...(showGlobal ? globalNotes.notes.flatMap((note) => note.tags) : []),
        ])
    ).sort((a, b) => a.localeCompare(b));
    const editingEntry = editingNote && entries.find((entry) => entry.id === editingNote.id);
    const editingGlobal = editingNote && globalNotes.notes.find((note) => note.id === editingNote.id);
    const openNewNote = (entryDate: string) => {
        setDatedNew(true);
        setEditingNote({ id: window.crypto.randomUUID(), entryDate });
    };
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const visibleGlobalNotes = (showGlobal ? globalNotes.notes : []).filter(
        (note) =>
            (!selectedTag || note.tags.some((tag) => tag.toLocaleLowerCase() === selectedTag.toLocaleLowerCase())) &&
            (!normalizedQuery ||
                note.title.toLocaleLowerCase().includes(normalizedQuery) ||
                note.body.toLocaleLowerCase().includes(normalizedQuery) ||
                note.tags.some((tag) => tag.toLocaleLowerCase().includes(normalizedQuery)))
    );
    const visibleHasContent = weeks.length > 0 || visibleGlobalNotes.length > 0;

    /** A note's Markdown with a commentary rail per section, or one rail when it has no sections. */
    const commentaryBody = (
        noteId: string,
        heading: string,
        body: string,
        sectionCommand: SectionCommand | null,
        onBodyChange: (body: string) => void
    ) => {
        const noteComments = comments.byNote.get(noteId) ?? [];
        const keys = sectionKeys(body);
        const sectioned = keys.length > 0;
        const liveIds = new Set((sectioned ? keys : [WHOLE_NOTE]).map((value) => commentaryId(noteId, value)));
        const commentaryProps = (sectionName: string, label: string) => {
            const id = commentaryId(noteId, sectionName);
            return {
                id,
                label,
                noteId,
                comment: noteComments.find((comment) => comment.id === id),
                onSave: comments.save,
                onRemove: comments.remove,
            };
        };
        const markdown = (
            <MarkdownNoteBody
                body={body}
                className="idea-body journal-body markdown-body"
                sectionCommand={sectionCommand}
                sectionAside={
                    sectioned
                        ? (sectionHeading, content, section) => (
                              <CommentaryAside
                                  key={sectionKey(sectionHeading)}
                                  {...commentaryProps(sectionKey(sectionHeading), sectionHeading)}
                                  anchor="heading"
                                  sectionExpanded={section.expanded}
                                  onSectionExpand={section.setExpanded}
                              >
                                  {content}
                              </CommentaryAside>
                          )
                        : null
                }
                onBodyChange={onBodyChange}
            />
        );
        return (
            <>
                {sectioned ? (
                    markdown
                ) : (
                    <CommentaryAside key={WHOLE_NOTE} {...commentaryProps(WHOLE_NOTE, heading)}>
                        {markdown}
                    </CommentaryAside>
                )}
                <DetachedCommentary
                    comments={noteComments.filter((comment) => !liveIds.has(comment.id))}
                    onRemove={comments.remove}
                />
            </>
        );
    };

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
                                {/* An untitled note previews its first line only while collapsed; open, the body shows it. */}
                                <span className="journal-note-title">
                                    {entry.title.trim() || !expanded ? heading : ''}
                                </span>
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
                </div>
                <div id={`note-${key}-details`} hidden={!expanded}>
                    {commentaryBody(entry.id, heading, entry.body, sectionCommand, (body) =>
                        journal.save({ ...entry, category: entry.category ?? null, body })
                    )}
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
                            className="card-action"
                            aria-label={`Edit ${heading}`}
                            onClick={() => setEditingNote({ id: entry.id, entryDate: entry.entryDate })}
                        >
                            <Pencil size={15} aria-hidden="true" />
                        </button>
                    </div>
                </div>
            </article>
        );
    };
    const renderGlobalSection = (notes: GlobalNote[]) =>
        notes.length > 0 && (
            <NoteGroup id="global-notes" title="Global notes" count={notes.length} item="note" isGlobal defaultExpanded>
                {notes.map((note) => (
                    <article key={note.id} className="idea-card global-note-card">
                        <div className="idea-card-top">
                            <h4 className="global-note-title">{note.title}</h4>
                        </div>
                        {commentaryBody(note.id, note.title, note.body || 'No body text.', null, (body) =>
                            globalNotes.save({ id: note.id, title: note.title, body, tags: note.tags })
                        )}
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
                                className="card-action"
                                aria-label={`Edit ${note.title}`}
                                onClick={() => {
                                    setDatedNew(false);
                                    setEditingNote({ id: note.id, entryDate: today });
                                }}
                            >
                                <Pencil size={15} aria-hidden="true" />
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
                    <section ref={workspaceRef} className="workspace" aria-label="Your notes">
                        <div className="workspace-tools">
                            <label className="search-wrap">
                                <Search size={16} aria-hidden="true" />
                                <span className="sr-only">Search notes</span>
                                <input
                                    className="search-input"
                                    type="search"
                                    placeholder="Search notes..."
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
                            </div>
                        </div>

                        {allTags.length > 0 && (
                            <div className="tag-filter-row" aria-label="Filter by tag">
                                {allTags.map((tag) => (
                                    <button
                                        key={tag.toLocaleLowerCase()}
                                        type="button"
                                        className="tag-chip tag-filter"
                                        aria-pressed={selectedTag === tag}
                                        onClick={() => setSelectedTag((current) => (current === tag ? null : tag))}
                                    >
                                        <Tag size={10} aria-hidden="true" />
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
                                    key={week.key}
                                    id={`week-${week.key}`}
                                    title={week.title}
                                    count={week.entries.length}
                                    item="note"
                                    expanded={expandedWeeks[week.key] ?? week.key === weekStart(today)}
                                    onExpandedChange={(expanded) =>
                                        setExpandedWeeks((current) => ({ ...current, [week.key]: expanded }))
                                    }
                                >
                                    {week.days.map((day) => {
                                        const dateLabel = formatEntryDate(day.entryDate);
                                        return (
                                            <section
                                                key={day.entryDate}
                                                className="journal-day"
                                                aria-label={`Notes for ${dateLabel}`}
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
                                                        <Plus size={12} aria-hidden="true" />
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
                                <h4>
                                    {filtering
                                        ? 'No notes match this search'
                                        : categoryFilter === 'global'
                                          ? 'No global notes yet'
                                          : `No ${categoryFilter} notes yet`}
                                </h4>
                            </div>
                        ) : null}
                    </section>
                </div>
            )}
            {editingNote !== undefined && (
                <NoteDialog
                    key={editingNote.id}
                    entryDate={editingEntry?.entryDate ?? editingNote.entryDate}
                    note={
                        editingEntry
                            ? { ...editingEntry, kind: kindOf(editingEntry.category) }
                            : editingGlobal
                              ? { ...editingGlobal, kind: 'global' }
                              : undefined
                    }
                    initialKind={datedNew && newKind === 'global' ? 'home' : newKind}
                    onClose={() => {
                        setDatedNew(false);
                        setEditingNote(undefined);
                    }}
                    onSave={(input) => {
                        const { id } = editingNote;
                        // Changing kind moves the note between daily and global storage under the same id, so
                        // its commentary follows it.
                        if (input.kind === 'global') {
                            const error = globalNotes.save({
                                id,
                                title: input.title,
                                body: input.body,
                                tags: input.tags,
                            });
                            return error ?? (editingEntry ? journal.remove(id, editingEntry.entryDate) : null);
                        }
                        const entryDate = editingEntry?.entryDate ?? input.entryDate;
                        const error = journal.save({
                            id,
                            entryDate,
                            title: input.title,
                            body: input.body,
                            tags: input.tags,
                            category: input.kind,
                        });
                        // A new note filed under another week opens that week so it can be seen.
                        if (!error)
                            setExpandedWeeks((current) => ({ ...current, [noteGroupKey(entryDate, today)]: true }));
                        return error ?? (editingGlobal ? globalNotes.remove(id) : null);
                    }}
                    onDelete={() =>
                        editingGlobal
                            ? globalNotes.remove(editingNote.id)
                            : journal.remove(editingNote.id, editingEntry?.entryDate ?? editingNote.entryDate)
                    }
                    onDraftProtectionChange={onDraftProtectionChange}
                />
            )}
        </>
    );
}
