import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import {
    Archive,
    ArrowDownLeft,
    Boxes,
    Check,
    Clock3,
    Lightbulb,
    Pin,
    Search,
    Settings2,
    Tag,
    Trash2,
    X,
} from 'lucide-react';
import { filterIdeas, formatIdeaTimestamp, parseTags, readIdeaView, writeIdeaView } from './ideas';
import type { SolutionFilter } from './ideas';
import { SelectField } from './SelectField';
import { PageLoading } from './Loading';
import { useTheme } from './ThemeContext';
import { useEditorDismissal } from './useEditorDismissal';
import type { Idea, IdeaStatus, IdeaView } from './types';
import type { Solution } from '../shared/contracts';
import type { useIdeasSync } from './useIdeasSync';
import type { useSolutions } from './useSolutions';
import { statusForSolution } from '../shared/status';
import { ExpandableMarkdownBody, MarkdownNoteEditor } from './MarkdownNote';
import { useDetailsHover } from './useDetailsHover';

interface IdeaInput {
    title: string;
    body: string;
    tags: string[];
    solution: string | null;
    status: IdeaStatus;
}

interface IdeaDialogProps {
    idea: Idea | null;
    solutions: Solution[];
    defaultSolution: string | null;
    onClose: () => void;
    onSave: (value: IdeaInput) => string | null;
    onDelete: (id: string) => string | null;
}

const statusOptions: { value: IdeaStatus; label: string }[] = [
    { value: 'open', label: 'Open' },
    { value: 'in-progress', label: 'In progress' },
    { value: 'done', label: 'Done' },
];

/** Shows the directory name, or the raw id when a solution was removed from the directory. */
const solutionName = (solutions: Solution[], id: string) => solutions.find((item) => item.id === id)?.name ?? id;

/** Enabled solutions, plus the current value so a link to a disabled or removed solution stays visible. */
function solutionOptions(solutions: Solution[], current: string | null) {
    const listed = solutions.filter((item) => !item.disabled).map((item) => ({ value: item.id, label: item.name }));
    if (current && !listed.some((item) => item.value === current))
        listed.push({ value: current, label: solutionName(solutions, current) });
    return listed;
}

interface SolutionsDialogProps {
    solutions: Solution[];
    onToggle: (id: string, disabled: boolean) => Promise<string | null>;
    onClose: () => void;
}

function SolutionsDialog({ solutions, onToggle, onClose }: SolutionsDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const [error, setError] = useState<string | null>(null);
    const enabledCount = solutions.filter((item) => !item.disabled).length;

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const returnFocus = returnFocusRef.current;
        if (dialog && !dialog.open) dialog.showModal();
        dialog?.focus({ preventScroll: true });
        return () => {
            if (dialog?.open) dialog.close();
            if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        };
    }, []);

    return (
        <dialog
            ref={dialogRef}
            className="dialog-backdrop"
            aria-labelledby="solutions-dialog-title"
            tabIndex={-1}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClick={(event) => {
                if (event.target === dialogRef.current) onClose();
            }}
        >
            <div className="idea-form">
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Applies on every device</p>
                        <h2 id="solutions-dialog-title">Manage solutions</h2>
                        <p>Unchecked solutions leave the pickers. Ideas already linked keep their link.</p>
                    </div>
                </div>
                {solutions.length > 0 ? (
                    <>
                        <p className="field-hint" aria-live="polite">
                            {enabledCount} of {solutions.length} enabled
                        </p>
                        <ul className="solution-settings">
                            {solutions.map((item) => (
                                <li key={item.id}>
                                    <label className="solution-setting">
                                        <input
                                            type="checkbox"
                                            checked={!item.disabled}
                                            onChange={(event) => {
                                                setError(null);
                                                void onToggle(item.id, !event.target.checked).then(setError);
                                            }}
                                        />
                                        <span>{item.name}</span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    </>
                ) : (
                    <p className="field-hint">The solution list is unavailable. Reconnect and try again.</p>
                )}
                {error && (
                    <p className="dialog-error" role="alert">
                        {error}
                    </p>
                )}
                <div className="dialog-footer">
                    <button type="button" className="secondary-button" onClick={onClose}>
                        OK
                    </button>
                </div>
            </div>
        </dialog>
    );
}

const views: { id: IdeaView; label: string; icon: typeof Lightbulb }[] = [
    { id: 'all', label: 'All ideas', icon: Lightbulb },
    { id: 'pinned', label: 'Pinned', icon: Pin },
    { id: 'archived', label: 'Archived', icon: Archive },
];

function IdeaDialog({
    idea,
    solutions,
    defaultSolution,
    onClose,
    onSave,
    onDelete,
    onDraftProtectionChange,
}: IdeaDialogProps & { onDraftProtectionChange: (protectedDraft: boolean) => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);
    const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const isAppleTouchDevice =
        /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const [formError, setFormError] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const dismissal = useEditorDismissal(
        dialogRef,
        Boolean(idea?.title.trim() || idea?.body.trim()),
        onDraftProtectionChange
    );
    const [solution, setSolution] = useState<string | null>(idea ? idea.solution : defaultSolution);
    const [status, setStatus] = useState<IdeaStatus>(() => statusForSolution(solution, idea?.status));
    const statusIndex = statusOptions.findIndex((option) => option.value === status);
    const statusStyle: CSSProperties & { '--segment-index': number } = { '--segment-index': statusIndex };

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const returnFocus = returnFocusRef.current;
        // React ignores autoFocus on forms; set it before showModal to avoid focusing the title.
        formRef.current?.toggleAttribute('autofocus', isAppleTouchDevice);
        if (dialog && !dialog.open) dialog.showModal();
        if (isAppleTouchDevice) dialog?.focus({ preventScroll: true });
        else titleRef.current?.focus({ preventScroll: true });
        return () => {
            if (dialog?.open) dialog.close();
            if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        };
    }, [isAppleTouchDevice]);

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const title = String(formData.get('title') ?? '').trim();
        if (!title) {
            setFormError('Add a title before saving this idea.');
            titleRef.current?.focus();
            return;
        }
        const error = onSave({
            title,
            body: String(formData.get('body') ?? '').trim(),
            tags: parseTags(String(formData.get('tags') ?? '')),
            solution,
            status,
        });
        if (error) {
            setFormError(error);
            return;
        }
        onClose();
    };

    const handleDelete = () => {
        if (!idea) return;
        if (!confirmingDelete) {
            setConfirmingDelete(true);
            return;
        }
        const error = onDelete(idea.id);
        if (error) {
            setFormError(error);
            return;
        }
        onClose();
    };

    return (
        <dialog
            ref={dialogRef}
            className="dialog-backdrop editor-dialog"
            aria-label={idea ? 'Edit idea' : 'New idea'}
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
                    dismissal.setProtectedDraft(
                        Boolean(String(data.get('title') ?? '').trim() || String(data.get('body') ?? '').trim())
                    );
                }}
            >
                <label className="field-group">
                    <span className="field-label">Idea title</span>
                    <input
                        ref={titleRef}
                        className="field-input"
                        name="title"
                        type="text"
                        maxLength={100}
                        defaultValue={idea?.title ?? ''}
                        required
                    />
                </label>
                <MarkdownNoteEditor
                    label="Details"
                    bodyRef={bodyRef}
                    name="body"
                    maxLength={5000}
                    defaultValue={idea?.body ?? ''}
                />
                <label className="field-group">
                    <span className="field-label">Tags</span>
                    <input
                        className="field-input"
                        name="tags"
                        type="text"
                        maxLength={300}
                        defaultValue={idea?.tags.join(', ') ?? ''}
                        aria-describedby="tag-hint"
                    />
                    <span className="field-hint" id="tag-hint">
                        Separate tags with commas. Up to 12 tags.
                    </span>
                </label>
                <div className="field-row">
                    <div className="field-group">
                        <span className="field-label" id="solution-label">
                            Solution
                        </span>
                        <SelectField
                            ariaLabel="Solution"
                            icon={Boxes}
                            className="field-select"
                            value={solution ?? ''}
                            options={[{ value: '', label: 'No solution' }, ...solutionOptions(solutions, solution)]}
                            onChange={(next) => {
                                const selected = next || null;
                                setSolution(selected);
                                setStatus(statusForSolution(selected, status));
                            }}
                        />
                    </div>
                    <div className="field-group">
                        <span className="field-label">Status</span>
                        <div className="segmented status-segmented" role="group" aria-label="Status">
                            {solution === null ? (
                                <button type="button" className="segment-button" aria-pressed="true" disabled>
                                    N/A
                                </button>
                            ) : (
                                <>
                                    <span className="segment-fill" style={statusStyle} aria-hidden="true" />
                                    {statusOptions.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className="segment-button"
                                            aria-pressed={status === option.value}
                                            onClick={() => setStatus(option.value)}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </>
                            )}
                        </div>
                    </div>
                </div>
                {formError && (
                    <p className="dialog-error" role="alert">
                        {formError}
                    </p>
                )}
                <div className="dialog-footer">
                    {idea && (
                        <button
                            type="button"
                            className="danger-button"
                            data-confirming={confirmingDelete}
                            aria-label={confirmingDelete ? 'Confirm delete' : 'Delete idea'}
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
                        Save idea
                    </button>
                </div>
            </form>
        </dialog>
    );
}

interface IdeaCardProps {
    idea: Idea;
    solutions: Solution[];
    onEdit: (idea: Idea) => void;
    onCreateTask: (title: string, body: string) => void;
    onTogglePin: (idea: Idea) => void;
    onToggleArchive: (idea: Idea) => void;
    onSelectTag: (tag: string) => void;
    onSelectSolution: (solution: string) => void;
}

function IdeaCard({
    idea,
    solutions,
    onEdit,
    onCreateTask,
    onTogglePin,
    onToggleArchive,
    onSelectTag,
    onSelectSolution,
}: IdeaCardProps) {
    const [expanded, setExpanded] = useState(false);
    const detailsId = useId();
    const hover = useDetailsHover();
    return (
        <article
            className="idea-card idea-markdown-card"
            data-expanded={expanded}
            tabIndex={0}
            aria-labelledby={`${detailsId}-title`}
        >
            <div className="idea-card-content" {...hover}>
                <div className="idea-card-top">
                    <span className="card-label">
                        {idea.pinned ? (
                            <Pin size={12} aria-hidden="true" />
                        ) : (
                            <Lightbulb size={12} aria-hidden="true" />
                        )}
                        {idea.pinned ? 'Pinned thought' : 'Saved thought'}
                    </span>
                    <div className="card-actions">
                        <button
                            type="button"
                            className="card-action"
                            aria-label={idea.pinned ? `Unpin ${idea.title}` : `Pin ${idea.title}`}
                            aria-pressed={idea.pinned}
                            onClick={() => onTogglePin(idea)}
                        >
                            <Pin size={15} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            className="card-action"
                            aria-label={idea.archived ? `Restore ${idea.title}` : `Archive ${idea.title}`}
                            onClick={() => onToggleArchive(idea)}
                        >
                            {idea.archived ? (
                                <ArrowDownLeft size={15} aria-hidden="true" />
                            ) : (
                                <Archive size={15} aria-hidden="true" />
                            )}
                        </button>
                    </div>
                </div>
                <h4 id={`${detailsId}-title`} className="idea-title">
                    {idea.title}
                </h4>
                {(idea.solution || idea.status !== 'open') && (
                    <div className="idea-meta">
                        {idea.solution && (
                            <button
                                type="button"
                                className="solution-chip"
                                aria-label={`Filter by solution ${solutionName(solutions, idea.solution)}`}
                                onClick={() => onSelectSolution(idea.solution ?? '')}
                            >
                                <Boxes size={11} aria-hidden="true" />
                                {solutionName(solutions, idea.solution)}
                            </button>
                        )}
                        <span className="status-chip" data-status={idea.status}>
                            {idea.status === 'n/a'
                                ? 'N/A'
                                : statusOptions.find((option) => option.value === idea.status)?.label}
                        </span>
                    </div>
                )}
                {idea.body && (
                    <>
                        <ExpandableMarkdownBody id={detailsId} className="idea-details" body={idea.body} />
                        <button
                            type="button"
                            className="text-button idea-details-toggle"
                            aria-expanded={expanded}
                            aria-controls={detailsId}
                            onClick={() => setExpanded((value) => !value)}
                        >
                            {expanded ? 'Show less' : 'Show details'}
                        </button>
                    </>
                )}
                <div className="idea-tags">
                    {idea.tags.map((tag) => (
                        <button
                            key={tag.toLocaleLowerCase()}
                            className="tag-chip tag-filter"
                            type="button"
                            aria-label={`Filter by ${tag}`}
                            onClick={() => onSelectTag(tag)}
                        >
                            <Tag size={10} aria-hidden="true" />
                            {tag}
                        </button>
                    ))}
                </div>
            </div>
            <div className="idea-card-bottom">
                <span className="idea-date">
                    <Clock3 size={12} aria-hidden="true" />
                    <time dateTime={idea.updatedAt}>{formatIdeaTimestamp(idea.updatedAt)}</time>
                </span>
                <div className="card-actions">
                    <button
                        type="button"
                        className="edit-button"
                        aria-label={`Create task from ${idea.title}`}
                        onClick={() => onCreateTask(idea.title, idea.body)}
                    >
                        Create task
                    </button>
                    <button type="button" className="edit-button" onClick={() => onEdit(idea)}>
                        Edit
                    </button>
                </div>
            </div>
        </article>
    );
}

export interface IdeasPageProps {
    sync: ReturnType<typeof useIdeasSync>;
    solutionsState: ReturnType<typeof useSolutions>;
    ready: boolean;
    syncBadge: ReactNode;
    editingIdea: Idea | null | undefined;
    setEditingIdea: (idea: Idea | null | undefined) => void;
    onCreateTask: (title: string, body: string) => void;
    onDraftProtectionChange: (protectedDraft: boolean) => void;
}

export function IdeasPage({
    sync,
    solutionsState,
    ready: initialReady,
    syncBadge,
    editingIdea,
    setEditingIdea,
    onCreateTask,
    onDraftProtectionChange,
}: IdeasPageProps) {
    const { storageWarning: themeStorageWarning } = useTheme();
    const { ideas } = sync;
    const [initialView] = useState(readIdeaView);
    const [view, setView] = useState<IdeaView>(initialView.view);
    const [viewNotice, setViewNotice] = useState<string | null>(initialView.error);
    const storageNotice = sync.notice ?? viewNotice;
    const setStorageNotice = (notice: string | null) => {
        if (notice === null) sync.clearNotice();
        setViewNotice(notice);
    };
    const [query, setQuery] = useState('');
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [solutionFilter, setSolutionFilter] = useState<SolutionFilter>('all');
    const [managingSolutions, setManagingSolutions] = useState(false);
    const { solutions, setDisabled: setSolutionDisabled } = solutionsState;
    const linkedIds = Array.from(new Set(ideas.flatMap((idea) => (idea.solution ? [idea.solution] : []))));
    const filterOptions = [
        { value: 'all', label: 'All solutions' },
        { value: 'none', label: 'No solution' },
        ...solutionOptions(solutions, solutionFilter === 'all' || solutionFilter === 'none' ? null : solutionFilter),
        // Ideas linked to a solution that has left the directory stay reachable by id.
        ...linkedIds
            .filter((id) => id !== solutionFilter && !solutions.some((item) => item.id === id))
            .map((id) => ({ value: id, label: id })),
    ];

    const activeIdeas = ideas.filter((idea) => !idea.archived);
    const pinnedIdeas = activeIdeas.filter((idea) => idea.pinned);
    const archivedIdeas = ideas.filter((idea) => idea.archived);
    const visibleIdeas = filterIdeas(ideas, view, query, selectedTag, solutionFilter);
    const filtering = Boolean(query || selectedTag) || solutionFilter !== 'all';
    const allTags = Array.from(new Set(ideas.flatMap((idea) => idea.tags))).sort((a, b) => a.localeCompare(b));
    const activeView = views.find((item) => item.id === view) ?? views[0];
    const selectedViewIndex = views.findIndex((item) => item.id === view);
    const segmentStyle: CSSProperties & { '--segment-index': number } = { '--segment-index': selectedViewIndex };

    const showStorageError = (error: string | null) => {
        if (error) setStorageNotice(error);
    };

    const saveIdea = ({ title, body, tags, solution, status }: IdeaInput): string | null => {
        const now = new Date().toISOString();
        const current = editingIdea ? ideas.find((idea) => idea.id === editingIdea.id) : undefined;
        return current
            ? sync.update({ ...current, title, body, tags, solution, status, updatedAt: now })
            : sync.create({
                  id: window.crypto.randomUUID(),
                  title,
                  body,
                  tags,
                  solution,
                  status,
                  createdAt: now,
                  updatedAt: now,
                  pinned: false,
                  archived: false,
              });
    };

    const updateIdea = (target: Idea, update: Partial<Pick<Idea, 'pinned' | 'archived'>>) => {
        const current = ideas.find((idea) => idea.id === target.id);
        if (current) sync.update({ ...current, ...update, updatedAt: new Date().toISOString() });
    };

    const chooseView = (nextView: IdeaView) => {
        setView(nextView);
        showStorageError(writeIdeaView(nextView));
    };

    const viewCounts: Record<IdeaView, number> = {
        all: activeIdeas.length,
        pinned: pinnedIdeas.length,
        archived: archivedIdeas.length,
    };

    return (
        <>
            {storageNotice && (
                <div className="storage-notice" role="alert">
                    <span>{storageNotice}</span>
                    <button type="button" aria-label="Dismiss storage notice" onClick={() => setStorageNotice(null)}>
                        <X size={16} aria-hidden="true" />
                    </button>
                </div>
            )}
            {themeStorageWarning && !storageNotice && (
                <div className="storage-notice" role="alert">
                    <span>{themeStorageWarning}</span>
                </div>
            )}

            {!initialReady ? (
                <PageLoading
                    label="Loading ideas"
                    message={
                        sync.status === 'offline'
                            ? 'You are offline. Ideas will load when the connection returns.'
                            : sync.status === 'paused'
                              ? 'Ideas could not sync. Retrying automatically.'
                              : undefined
                    }
                />
            ) : (
                <div className="data-enter">
                    <section className="intro" aria-label="Sync status">
                        <div className="intro-aside">{syncBadge}</div>
                    </section>

                    <section className="workspace" aria-label="Your ideas">
                        <div className="workspace-tools">
                            <label className="search-wrap">
                                <Search size={16} aria-hidden="true" />
                                <span className="sr-only">Search ideas</span>
                                <input
                                    className="search-input"
                                    type="search"
                                    placeholder="Search a thought, detail, or tag..."
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                />
                            </label>
                            <div className="solution-tools">
                                <SelectField
                                    ariaLabel="Filter by solution"
                                    icon={Boxes}
                                    className="filter-select"
                                    value={solutionFilter}
                                    options={filterOptions}
                                    onChange={setSolutionFilter}
                                />
                                <button
                                    type="button"
                                    className="icon-button manage-solutions"
                                    aria-label="Manage solutions"
                                    onClick={() => setManagingSolutions(true)}
                                >
                                    <Settings2 size={16} aria-hidden="true" />
                                </button>
                            </div>
                            <div className="segmented" role="group" aria-label="Idea view">
                                <span className="segment-fill" style={segmentStyle} aria-hidden="true" />
                                {views.map(({ id, label, icon: Icon }) => (
                                    <button
                                        key={id}
                                        type="button"
                                        className="segment-button"
                                        aria-pressed={view === id}
                                        onClick={() => chooseView(id)}
                                    >
                                        <Icon size={13} aria-hidden="true" />
                                        {label}
                                        <span>{viewCounts[id]}</span>
                                    </button>
                                ))}
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

                        <div className="content-heading">
                            <h3>{selectedTag ? `Tagged “${selectedTag}”` : activeView.label}</h3>
                            <span className="result-count" aria-live="polite">
                                {visibleIdeas.length} {visibleIdeas.length === 1 ? 'note' : 'notes'}
                            </span>
                        </div>

                        {visibleIdeas.length > 0 ? (
                            <div className="idea-grid">
                                {visibleIdeas.map((idea) => (
                                    <IdeaCard
                                        key={idea.id}
                                        idea={idea}
                                        solutions={solutions}
                                        onEdit={setEditingIdea}
                                        onCreateTask={onCreateTask}
                                        onTogglePin={(target) => updateIdea(target, { pinned: !target.pinned })}
                                        onToggleArchive={(target) => updateIdea(target, { archived: !target.archived })}
                                        onSelectTag={(tag) => {
                                            setSelectedTag(tag);
                                            chooseView('all');
                                        }}
                                        onSelectSolution={setSolutionFilter}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <span className="empty-icon" aria-hidden="true">
                                    {filtering ? <Search size={21} /> : <Lightbulb size={22} />}
                                </span>
                                <h4>
                                    {filtering
                                        ? 'No ideas match this search'
                                        : view === 'pinned'
                                          ? 'Nothing pinned yet'
                                          : view === 'archived'
                                            ? 'Your archive is clear'
                                            : 'No ideas yet'}
                                </h4>
                            </div>
                        )}
                    </section>
                </div>
            )}

            {editingIdea !== undefined && (
                <IdeaDialog
                    key={editingIdea?.id ?? 'new'}
                    idea={editingIdea}
                    solutions={solutions}
                    defaultSolution={solutionFilter === 'all' || solutionFilter === 'none' ? null : solutionFilter}
                    onClose={() => setEditingIdea(undefined)}
                    onSave={saveIdea}
                    onDelete={sync.remove}
                    onDraftProtectionChange={onDraftProtectionChange}
                />
            )}
            {managingSolutions && (
                <SolutionsDialog
                    solutions={solutions}
                    onToggle={setSolutionDisabled}
                    onClose={() => setManagingSolutions(false)}
                />
            )}
        </>
    );
}
