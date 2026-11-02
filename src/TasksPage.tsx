import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { CalendarDays, Check, GripVertical, ListTodo, Plus, Search, Trash2, X } from 'lucide-react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { taskLimits } from '../shared/tasks';
import type { ServerTask, TaskCategory } from '../shared/tasks';
import { CalendarDialog } from './CalendarDialog';
import { formatEntryDate, weekStart } from './journal';
import { PageLoading } from './Loading';
import { NoteGroup } from './NoteGroup';
import { readTaskCategory, writeTaskCategory } from './tasksSync';
import { useEditorDismissal } from './useEditorDismissal';
import { useTheme } from './ThemeContext';
import type { useTasksSync } from './useTasksSync';

export interface TaskEditorTarget {
    id: string;
    taskDate: string;
    fromCalendar?: boolean;
}
type TaskInput = { id: string; taskDate: string; category: TaskCategory; title: string; body: string };

function TaskCategories({
    value,
    onChange,
    label,
}: {
    value: TaskCategory;
    onChange: (value: TaskCategory) => void;
    label: string;
}) {
    const style: CSSProperties & { '--segment-index': number } = { '--segment-index': value === 'home' ? 0 : 1 };
    return (
        <div className="segmented task-categories" role="group" aria-label={label}>
            <span className="segment-fill" style={style} aria-hidden="true" />
            {(['home', 'work'] as const).map((category) => (
                <button
                    key={category}
                    type="button"
                    className="segment-button"
                    aria-pressed={value === category}
                    onClick={() => onChange(category)}
                >
                    {category === 'home' ? 'Home' : 'Work'}
                </button>
            ))}
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
    const formRef = useRef<HTMLFormElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const touch =
        /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const [section, setSection] = useState(task?.category ?? category);
    const [error, setError] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const dismissal = useEditorDismissal(
        dialogRef,
        Boolean(task?.title.trim() || task?.body.trim()),
        onDraftProtectionChange
    );
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
            taskDate: target.taskDate,
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
            aria-labelledby="task-dialog-title"
            tabIndex={-1}
            data-replacing={target.fromCalendar ?? false}
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
                    const data = new FormData(formRef.current);
                    dismissal.setProtectedDraft(
                        Boolean(String(data.get('title') ?? '').trim() || String(data.get('body') ?? '').trim())
                    );
                }}
            >
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">{formatEntryDate(target.taskDate)}</p>
                        <h2 id="task-dialog-title">{task ? 'Edit task' : 'New task'}</h2>
                    </div>
                </div>
                <label className="field-group">
                    <span className="field-label">Task title</span>
                    <input
                        ref={titleRef}
                        className="field-input"
                        name="title"
                        type="text"
                        required
                        maxLength={taskLimits.title}
                        defaultValue={task?.title ?? ''}
                        placeholder="What needs doing?"
                    />
                </label>
                <label className="field-group">
                    <span className="field-label">Details</span>
                    <textarea
                        className="field-textarea journal-textarea"
                        name="body"
                        maxLength={taskLimits.body}
                        defaultValue={task?.body ?? ''}
                        placeholder="Optional details..."
                    />
                </label>
                <div className="field-group">
                    <span className="field-label">Section</span>
                    <TaskCategories label="Task category" value={section} onChange={setSection} />
                </div>
                {error && (
                    <p className="dialog-error" role="alert">
                        {error}
                    </p>
                )}
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
                    <button type="button" className="secondary-button" onClick={onClose}>
                        Cancel
                    </button>
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
}: {
    task: ServerTask;
    filtering: boolean;
    onComplete: (task: ServerTask, completed: boolean) => void;
    onEdit: (task: ServerTask) => void;
}) {
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
            <div className="task-text">
                <h5 className="task-title">{task.title}</h5>
                {task.body && <p className="task-body">{task.body}</p>}
            </div>
            <button
                type="button"
                className="edit-button"
                aria-label={`Edit ${task.title}`}
                onClick={() => onEdit(task)}
            >
                Edit
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
}: {
    tasks: ServerTask[];
    filtering: boolean;
    onComplete: (task: ServerTask, completed: boolean) => void;
    onEdit: (task: ServerTask) => void;
    onReorder: (ids: string[]) => void;
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
    syncBadge,
    onDraftProtectionChange,
}: {
    tasks: ReturnType<typeof useTasksSync>;
    today: string;
    editingTask: TaskEditorTarget | undefined;
    setEditingTask: (target: TaskEditorTarget | undefined) => void;
    syncBadge: ReactNode;
    onDraftProtectionChange: (value: boolean) => void;
}) {
    const [initialCategory] = useState(readTaskCategory);
    const [category, setCategory] = useState(initialCategory.category);
    const [categoryNotice, setCategoryNotice] = useState(initialCategory.error);
    const [query, setQuery] = useState('');
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});
    const dayRefs = useRef(new Map<string, HTMLElement>());
    const { storageWarning } = useTheme();
    const notice = tasks.notice ?? categoryNotice ?? storageWarning;
    const selectCategory = (value: TaskCategory) => {
        setCategory(value);
        setCategoryNotice(writeTaskCategory(value));
    };
    const inCategory = tasks.tasks.filter((task) => task.category === category);
    const needle = query.trim().toLocaleLowerCase();
    const visible = inCategory.filter(
        (task) =>
            !needle || task.title.toLocaleLowerCase().includes(needle) || task.body.toLocaleLowerCase().includes(needle)
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
    const addTask = (date: string, fromCalendar = false) =>
        setEditingTask({ id: crypto.randomUUID(), taskDate: date, fromCalendar });
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
                <div className="workspace">
                    {syncBadge}
                    <section className="workspace-panel" aria-label="Your tasks">
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
                                    placeholder="Search tasks or details..."
                                />
                            </label>
                            <div className="task-toolbar-actions">
                                <TaskCategories label="Task section" value={category} onChange={selectCategory} />
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
                        {needle && <p className="task-search-hint field-hint">Clear search to reorder tasks.</p>}
                        {[...weeks].map(([week, days]) => {
                            const key = `${category}-${week}`;
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
                                            className="task-day"
                                            aria-label={`Tasks for ${formatEntryDate(date)}`}
                                            ref={(element) => {
                                                if (element) dayRefs.current.set(date, element);
                                                else dayRefs.current.delete(date);
                                            }}
                                        >
                                            <div className="task-day-heading">
                                                <h4>
                                                    <time dateTime={date}>{formatEntryDate(date)}</time>
                                                </h4>
                                                <button
                                                    type="button"
                                                    className="text-button"
                                                    aria-label={`Add task for ${formatEntryDate(date)}`}
                                                    onClick={() => addTask(date)}
                                                >
                                                    <Plus size={14} aria-hidden="true" />
                                                    Add task
                                                </button>
                                            </div>
                                            <TaskDay
                                                tasks={daily}
                                                filtering={Boolean(needle)}
                                                onEdit={editTask}
                                                onComplete={(task, completed) => {
                                                    tasks.complete(task, completed);
                                                }}
                                                onReorder={(ids) => {
                                                    tasks.reorder(date, category, ids);
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
                                        : `No ${category === 'home' ? 'home' : 'work'} tasks yet`}
                                </h4>
                                <p>
                                    {needle
                                        ? 'Try another phrase.'
                                        : 'Add a task for today or choose a day from the calendar.'}
                                </p>
                                {!needle && (
                                    <button type="button" className="primary-button" onClick={() => addTask(today)}>
                                        <Plus size={15} aria-hidden="true" />
                                        New task
                                    </button>
                                )}
                            </div>
                        )}
                    </section>
                </div>
            )}
            {editingTask && (
                <TaskDialog
                    key={editingTask.id}
                    target={editingTask}
                    task={currentTask}
                    category={category}
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
            {calendarOpen && (
                <CalendarDialog
                    label="Daily tasks"
                    today={today}
                    entries={inCategory.map((task) => task.taskDate)}
                    onClose={() => setCalendarOpen(false)}
                    onSelect={(date) => {
                        setCalendarOpen(false);
                        if (!inCategory.some((task) => task.taskDate === date)) {
                            addTask(date, true);
                            return;
                        }
                        setQuery('');
                        setExpandedWeeks((current) => ({ ...current, [`${category}-${weekStart(date)}`]: true }));
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
