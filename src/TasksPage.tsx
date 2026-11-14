import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { Briefcase, Check, GripVertical, House, Layers, ListTodo, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { taskCategories, taskLimits } from '../shared/tasks';
import type { ServerTask, TaskCategory } from '../shared/tasks';
import { DateField } from './CalendarDialog';
import { SelectField } from './SelectField';
import { formatEntryDate, weekStart } from './journal';
import { PageLoading } from './Loading';
import { NoteGroup } from './NoteGroup';
import { readTaskCategory, writeTaskCategory } from './tasksSync';
import type { TaskSection } from './tasksSync';
import { formEdited, useEditorDismissal } from './useEditorDismissal';
import { EditorSizeToggle, useEditorSize } from './EditorSize';
import { DialogCloseButton } from './DialogClose';
import { useSearchHighlight } from './searchHighlight';
import { useTheme } from './ThemeContext';
import type { useTasksSync } from './useTasksSync';
import { ExpandableMarkdownBody, MarkdownNoteEditor } from './MarkdownNote';
import { useDetailsHover } from './useDetailsHover';

export interface TaskEditorTarget {
    id: string;
    taskDate: string;
    initialTitle?: string;
    initialBody?: string;
}
type TaskInput = { id: string; taskDate: string; category: TaskCategory; title: string; body: string };

function TaskCategories<T extends TaskSection>({
    value,
    onChange,
    label,
    options,
}: {
    value: T;
    onChange: (value: T) => void;
    label: string;
    options: readonly T[];
}) {
    const style = {
        '--segment-index': options.indexOf(value),
        '--segment-count': options.length,
    } as CSSProperties;
    return (
        <div className="segmented task-categories page-pill" role="group" aria-label={label} style={style}>
            <span className="segment-fill" style={style} aria-hidden="true" />
            {options.map((category) => {
                const Icon = category === 'work' ? Briefcase : House;
                return (
                    <button
                        key={category}
                        type="button"
                        className="segment-button"
                        aria-pressed={value === category}
                        onClick={() => onChange(category)}
                    >
                        <Icon size={13} aria-hidden="true" />
                        {category === 'work' ? 'Work' : 'Home'}
                    </button>
                );
            })}
        </div>
    );
}

function TaskDialog({
    target,
    task,
    category,
    onSave,
    onDelete,
    onClose,
    onDraftProtectionChange,
}: {
    target: TaskEditorTarget;
    task: ServerTask | undefined;
    category: TaskCategory;
    onSave: (value: TaskInput) => string | null;
    onDelete: () => string | null;
    onClose: () => void;
    onDraftProtectionChange: (value: boolean) => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const editorSize = useEditorSize();
    const formRef = useRef<HTMLFormElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);
    const returnFocusRef = useRef(
        target.initialTitle !== undefined
            ? document.querySelector<HTMLElement>('.top-actions [aria-label="New task"]')
            : document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
    );
    const touch =
        /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const [section, setSection] = useState(task?.category ?? category);
    // A new task can be filed under any day; a saved task keeps its date.
    const [taskDate, setTaskDate] = useState(task?.taskDate ?? target.taskDate);
    const [error, setError] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const initialTitle = task?.title ?? target.initialTitle ?? '';
    const initialBody = task?.body ?? target.initialBody ?? '';
    // A new task prefilled from elsewhere is unsaved work; a saved task is only protected once it changes.
    const prefilled = !task && Boolean(initialTitle.trim() || initialBody.trim());
    const dismissal = useEditorDismissal(dialogRef, prefilled, onDraftProtectionChange);
    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const returnFocus = returnFocusRef.current;
        formRef.current?.toggleAttribute('autofocus', touch);
        if (dialog && !dialog.open) dialog.showModal();
        if (touch) dialog?.focus({ preventScroll: true });
        else titleRef.current?.focus({ preventScroll: true });
        return () => {
            if (dialog?.open) dialog.close();
            if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        };
    }, [touch]);
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const title = String(data.get('title') ?? '').trim();
        if (!title) {
            setError('Add a title before saving this task.');
            titleRef.current?.focus();
            return;
        }
        const result = onSave({
            id: target.id,
            taskDate,
            category: section,
            title,
            body: String(data.get('body') ?? ''),
        });
        if (result) setError(result);
        else onClose();
    };
    return (
        <dialog
            ref={dialogRef}
            className="dialog-backdrop editor-dialog"
            data-maximized={editorSize.maximized}
            aria-labelledby="task-dialog-title"
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
                tabIndex={touch ? -1 : undefined}
                onSubmit={submit}
                onChange={() => {
                    if (!formRef.current) return;
                    dismissal.setProtectedDraft(prefilled || formEdited(formRef.current));
                }}
            >
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Task</p>
                        <h2 id="task-dialog-title">{task ? 'Edit task' : 'New task'}</h2>
                    </div>
                </div>
                <label className="sr-only" htmlFor="task-title-input">
                    Title
                </label>
                <input
                    id="task-title-input"
                    ref={titleRef}
                    className="editor-title-input"
                    name="title"
                    type="text"
                    placeholder="Title"
                    required
                    maxLength={taskLimits.title}
                    defaultValue={initialTitle}
                />
                <div className="editor-chips">
                    <SelectField
                        ariaLabel="Section"
                        icon={Layers}
                        className="chip-select"
                        value={section}
                        options={[
                            { value: 'home', label: 'Home' },
                            { value: 'work', label: 'Work' },
                        ]}
                        onChange={(value) => setSection(value as TaskCategory)}
                    />
                    <DateField label="Date" value={taskDate} onChange={task ? undefined : setTaskDate} />
                </div>
                <MarkdownNoteEditor
                    label="Details"
                    bodyRef={bodyRef}
                    name="body"
                    maxLength={taskLimits.body}
                    defaultValue={initialBody}
                />
                {error && (
                    <p className="dialog-error" role="alert">
                        {error}
                    </p>
                )}
                <div className="dialog-corner-actions">
                    <EditorSizeToggle maximized={editorSize.maximized} onToggle={editorSize.toggle} />
                    <DialogCloseButton onClose={onClose} isProtected={dismissal.isProtected} />
                </div>
                <div className="dialog-footer">
                    {task && (
                        <button
                            type="button"
                            className="danger-button"
                            aria-label={confirmingDelete ? 'Confirm delete' : 'Delete task'}
                            onBlur={() => setConfirmingDelete(false)}
                            onClick={() => {
                                if (!confirmingDelete) {
                                    setConfirmingDelete(true);
                                    return;
                                }
                                const result = onDelete();
                                if (result) setError(result);
                                else onClose();
                            }}
                        >
                            <Trash2 size={15} aria-hidden="true" />
                            {confirmingDelete ? 'Confirm' : 'Delete'}
                        </button>
                    )}
                    <button type="submit" className="primary-button">
                        <Check size={15} aria-hidden="true" />
                        Save task
                    </button>
                </div>
            </form>
        </dialog>
    );
}

function TaskRow({
    task,
    filtering,
    onComplete,
    onEdit,
    onChangeBody,
}: {
    task: ServerTask;
    filtering: boolean;
    onComplete: (task: ServerTask, completed: boolean) => void;
    onEdit: (task: ServerTask) => void;
    onChangeBody: (task: ServerTask, body: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const detailsId = useId();
    const hover = useDetailsHover(() => setExpanded(true));
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
        id: task.id,
        disabled: filtering,
    });
    const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
    return (
        <li
            ref={setNodeRef}
            style={style}
            className="task-row"
            tabIndex={0}
            aria-labelledby={`${detailsId}-title`}
            data-expanded={expanded}
            data-completed={task.completed}
            data-dragging={isDragging}
        >
            <button
                ref={setActivatorNodeRef}
                type="button"
                className="task-drag-handle"
                {...attributes}
                {...listeners}
                aria-label={`Move ${task.title}`}
                disabled={filtering}
            >
                <GripVertical size={18} aria-hidden="true" />
            </button>
            <input
                className="task-checkbox"
                type="checkbox"
                checked={task.completed}
                aria-label={`${task.completed ? 'Reopen' : 'Complete'} ${task.title}`}
                onChange={(event) => onComplete(task, event.target.checked)}
            />
            <div className="task-text" {...hover}>
                <h5 id={`${detailsId}-title`} className="task-title">
                    {task.title}
                </h5>
                {task.body && (
                    <>
                        <ExpandableMarkdownBody
                            id={detailsId}
                            className="task-details"
                            body={task.body}
                            onBodyChange={(body) => onChangeBody(task, body)}
                        />
                        <button
                            type="button"
                            className="text-button task-details-toggle"
                            aria-expanded={expanded}
                            aria-controls={detailsId}
                            onClick={() => setExpanded((value) => !value)}
                        >
                            {expanded ? 'Show less' : 'Show details'}
                        </button>
                    </>
                )}
            </div>
            <button
                type="button"
                className="card-action"
                aria-label={`Edit ${task.title}`}
                onClick={() => onEdit(task)}
            >
                <Pencil size={15} aria-hidden="true" />
            </button>
        </li>
    );
}

function TaskDay({
    tasks,
    filtering,
    onComplete,
    onEdit,
    onReorder,
    onChangeBody,
}: {
    tasks: ServerTask[];
    filtering: boolean;
    onComplete: (task: ServerTask, completed: boolean) => void;
    onEdit: (task: ServerTask) => void;
    onReorder: (ids: string[]) => void;
    onChangeBody: (task: ServerTask, body: string) => void;
}) {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    const ids = tasks.map((task) => task.id);
    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={({ active, over }) => {
                if (!over || active.id === over.id) return;
                const from = ids.indexOf(String(active.id));
                const to = ids.indexOf(String(over.id));
                if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to));
            }}
        >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <ul className="task-list">
                    {tasks.map((task) => (
                        <TaskRow
                            key={task.id}
                            task={task}
                            filtering={filtering}
                            onComplete={onComplete}
                            onEdit={onEdit}
                            onChangeBody={onChangeBody}
                        />
                    ))}
                </ul>
            </SortableContext>
        </DndContext>
    );
}

export function TasksPage({
    tasks,
    today,
    editingTask,
    setEditingTask,
    onDraftProtectionChange,
}: {
    tasks: ReturnType<typeof useTasksSync>;
    today: string;
    editingTask: TaskEditorTarget | undefined;
    setEditingTask: (target: TaskEditorTarget | undefined) => void;
    onDraftProtectionChange: (value: boolean) => void;
}) {
    const [initialCategory] = useState(readTaskCategory);
    const [category, setCategory] = useState(initialCategory.category);
    const [displayedCategory, setDisplayedCategory] = useState(initialCategory.category);
    const listLeaving = category !== displayedCategory;
    useEffect(() => {
        const motion = matchMedia('(prefers-reduced-motion: reduce)');
        const settle = () => setDisplayedCategory(category);
        const timer = setTimeout(settle, motion.matches ? 0 : 250);
        const onMotionChange = () => {
            if (motion.matches) {
                clearTimeout(timer);
                settle();
            }
        };
        motion.addEventListener('change', onMotionChange);
        return () => {
            clearTimeout(timer);
            motion.removeEventListener('change', onMotionChange);
        };
    }, [category]);
    const [categoryNotice, setCategoryNotice] = useState(initialCategory.error);
    const [query, setQuery] = useState('');
    const workspaceRef = useRef<HTMLElement>(null);
    useSearchHighlight(workspaceRef, query, '.task-row');
    const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});
    const { storageWarning } = useTheme();
    const notice = tasks.notice ?? categoryNotice ?? storageWarning;
    const selectCategory = (value: TaskSection) => {
        setCategory(value);
        setCategoryNotice(writeTaskCategory(value));
    };
    const needle = query.trim().toLocaleLowerCase();
    const visible = tasks.tasks.filter(
        (task) =>
            (displayedCategory === 'all' || task.category === displayedCategory) &&
            (!needle ||
                task.title.toLocaleLowerCase().includes(needle) ||
                task.body.toLocaleLowerCase().includes(needle))
    );
    const weeks = new Map<string, Map<string, ServerTask[]>>();
    for (const task of visible) {
        const week = weekStart(task.taskDate);
        if (!weeks.has(week)) weeks.set(week, new Map());
        const days = weeks.get(week);
        if (!days) continue;
        const list = days.get(task.taskDate) ?? [];
        list.push(task);
        days.set(task.taskDate, list);
    }
    const currentTask = tasks.tasks.find((task) => task.id === editingTask?.id);
    const editTask = (task: ServerTask) => setEditingTask({ id: task.id, taskDate: task.taskDate });
    return (
        <>
            {notice && (
                <div className="storage-notice" role="alert">
                    <span>{notice}</span>
                    <button
                        type="button"
                        aria-label="Dismiss notice"
                        onClick={() => {
                            tasks.clearNotice();
                            setCategoryNotice(null);
                        }}
                    >
                        <X size={16} aria-hidden="true" />
                    </button>
                </div>
            )}
            {!tasks.ready ? (
                <PageLoading
                    label="Loading tasks"
                    message={
                        tasks.status === 'offline'
                            ? 'You are offline. Tasks will load when the connection returns.'
                            : tasks.status === 'paused'
                              ? 'Tasks could not sync. Retrying automatically.'
                              : undefined
                    }
                />
            ) : (
                <div className="data-enter">
                    <section ref={workspaceRef} className="workspace" aria-label="Your tasks">
                        <div className="workspace-tools">
                            <label className="search-wrap">
                                <Search size={16} aria-hidden="true" />
                                <span className="sr-only">Search tasks</span>
                                <input
                                    type="search"
                                    className="search-input"
                                    aria-label="Search tasks"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Search tasks..."
                                />
                            </label>
                            <div className="task-toolbar-actions">
                                <TaskCategories
                                    label="Task section"
                                    value={category}
                                    onChange={selectCategory}
                                    options={taskCategories}
                                />
                            </div>
                        </div>
                        {needle && <p className="task-search-hint field-hint">Clear search to reorder tasks.</p>}
                        <div className="task-list-transition" data-leaving={listLeaving} inert={listLeaving}>
                            {[...weeks].map(([week, days]) => {
                                const key = `${displayedCategory}-${week}`;
                                return (
                                    <NoteGroup
                                        key={key}
                                        id={`tasks-${key}`}
                                        title={`Week of ${formatEntryDate(week)}`}
                                        count={[...days.values()].reduce((count, list) => count + list.length, 0)}
                                        item="task"
                                        expanded={expandedWeeks[key] ?? week === weekStart(today)}
                                        onExpandedChange={(expanded) =>
                                            setExpandedWeeks((current) => ({ ...current, [key]: expanded }))
                                        }
                                    >
                                        {[...days].map(([date, daily]) => (
                                            <section
                                                key={date}
                                                className="task-day journal-day"
                                                aria-label={`Tasks for ${formatEntryDate(date)}`}
                                            >
                                                <div className="task-day-heading journal-day-heading">
                                                    <h4>
                                                        <time dateTime={date}>{formatEntryDate(date)}</time>
                                                    </h4>
                                                    {date === today && <span className="card-label">Today</span>}
                                                    <button
                                                        type="button"
                                                        className="icon-button journal-day-add"
                                                        aria-label={`Add a task for ${formatEntryDate(date)}`}
                                                        onClick={() =>
                                                            setEditingTask({ id: crypto.randomUUID(), taskDate: date })
                                                        }
                                                    >
                                                        <Plus size={12} aria-hidden="true" />
                                                    </button>
                                                </div>
                                                <TaskDay
                                                    tasks={daily}
                                                    filtering={Boolean(needle) || displayedCategory === 'all'}
                                                    onEdit={editTask}
                                                    onComplete={(task, completed) => {
                                                        tasks.complete(task, completed);
                                                    }}
                                                    onChangeBody={(task, body) => {
                                                        tasks.save({
                                                            id: task.id,
                                                            taskDate: task.taskDate,
                                                            category: task.category,
                                                            title: task.title,
                                                            body,
                                                        });
                                                    }}
                                                    onReorder={(ids) => {
                                                        if (displayedCategory !== 'all')
                                                            tasks.reorder(date, displayedCategory, ids);
                                                    }}
                                                />
                                            </section>
                                        ))}
                                    </NoteGroup>
                                );
                            })}
                            {weeks.size === 0 && (
                                <div className="empty-state">
                                    <span className="empty-icon">
                                        <ListTodo size={22} aria-hidden="true" />
                                    </span>
                                    <h4>
                                        {needle
                                            ? 'No tasks match this search'
                                            : displayedCategory === 'all'
                                              ? 'No tasks yet'
                                              : `No ${displayedCategory} tasks yet`}
                                    </h4>
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            )}
            {editingTask && (
                <TaskDialog
                    key={editingTask.id}
                    target={editingTask}
                    task={currentTask}
                    category={category === 'all' ? 'home' : category}
                    onDraftProtectionChange={onDraftProtectionChange}
                    onClose={() => setEditingTask(undefined)}
                    onSave={(value) => {
                        const error = tasks.save(value);
                        if (!error) {
                            selectCategory(value.category);
                            setQuery('');
                            setExpandedWeeks((current) => ({
                                ...current,
                                [`${value.category}-${weekStart(value.taskDate)}`]: true,
                            }));
                        }
                        return error;
                    }}
                    onDelete={() => (currentTask ? tasks.remove(currentTask) : 'This task is no longer available.')}
                />
            )}
        </>
    );
}
