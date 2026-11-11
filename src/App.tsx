import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Lightbulb, ListTodo, NotebookPen, Plus, RefreshCw } from 'lucide-react';
import { IdeasPage } from './IdeasPage';
import { localDateKey } from './journal';
import { NotesPage } from './NotesPage';
import { SyncBadge, worstStatus } from './SyncBadge';
import { THEME_ICONS, useTheme } from './ThemeContext';
import { ThemeMenu } from './ThemeMenu';
import type { Idea } from './types';
import { useFirstLoad } from './useFirstLoad';
import { useIdeasSync } from './useIdeasSync';
import { useJournalSync } from './useJournalSync';
import { useGlobalNotesSync } from './useGlobalNotesSync';
import { useTasksSync } from './useTasksSync';
import { TasksPage } from './TasksPage';
import type { TaskEditorTarget } from './TasksPage';
import type { Route } from './useRoute';
import { useRoute } from './useRoute';
import { useSolutions } from './useSolutions';
import { shortcutRoute } from './pageShortcuts';

const pages: { route: Route; label: string; icon: typeof Lightbulb; shortcut: string }[] = [
    { route: '/notes', label: 'Notes', icon: NotebookPen, shortcut: 'N' },
    { route: '/tasks', label: 'Tasks', icon: ListTodo, shortcut: 'T' },
    { route: '/ideas', label: 'Ideas', icon: Lightbulb, shortcut: 'I' },
];

const LEAVE_MS = 250;

export function App() {
    const { resolvedTheme } = useTheme();
    const sync = useIdeasSync();
    const journal = useJournalSync();
    const globalNotes = useGlobalNotesSync();
    const tasks = useTasksSync();
    const solutionsState = useSolutions();
    const [cachedAtEntry] = useState(sync.ready);
    const [protectedDraft, setProtectedDraft] = useState(false);
    const [route, navigate] = useRoute(() => !protectedDraft);
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const target = shortcutRoute(event);
            if (!target) return;
            event.preventDefault();
            navigate(target);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [navigate]);
    // The page on screen lags the route while the old page fades out.
    const [shown, setShown] = useState(route);
    const [editingIdea, setEditingIdea] = useState<Idea | null | undefined>(undefined);
    const [editingDate, setEditingDate] = useState<string | undefined>(undefined);
    const [editingTask, setEditingTask] = useState<TaskEditorTarget | undefined>();
    const [headerRefreshing, setHeaderRefreshing] = useState(false);

    const [dialogRoute, setDialogRoute] = useState(route);
    if (dialogRoute !== route) {
        // Back and forward can change pages under an open dialog; close it.
        setDialogRoute(route);
        setEditingIdea(undefined);
        setEditingDate(undefined);
        if (route !== '/tasks') setEditingTask(undefined);
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    useEffect(() => {
        if (shown === route) return;
        const timer = window.setTimeout(() => setShown(route), reducedMotion ? 0 : LEAVE_MS);
        return () => window.clearTimeout(timer);
    }, [route, shown, reducedMotion]);
    const displayed = reducedMotion ? route : shown;
    const leaving = displayed !== route;

    const ideasReady = sync.ready && (cachedAtEntry || solutionsState.ready);
    const onNotes = displayed === '/notes';
    const onTasks = displayed === '/tasks';
    const pageStatus = onTasks ? tasks.status : onNotes ? worstStatus(journal.status, globalNotes.status) : sync.status;
    useFirstLoad(
        onTasks ? tasks.ready : onNotes ? journal.ready && globalNotes.ready : ideasReady,
        pageStatus === 'offline' || pageStatus === 'paused'
    );

    const refreshBusy =
        sync.refreshing || journal.refreshing || globalNotes.refreshing || tasks.refreshing || headerRefreshing;
    const refreshAll = async () => {
        if (refreshBusy) return;
        setHeaderRefreshing(true);
        try {
            await Promise.all([
                sync.refresh(),
                journal.refresh(),
                globalNotes.refresh(),
                tasks.refresh(),
                solutionsState.refresh(),
            ]);
        } finally {
            setHeaderRefreshing(false);
        }
    };

    const syncBadge = (
        <SyncBadge
            status={worstStatus(sync.status, journal.status, globalNotes.status, tasks.status)}
            waiting={sync.waiting + journal.waiting + globalNotes.waiting + tasks.waiting}
        />
    );
    const routeIndex = pages.findIndex((page) => page.route === route);
    const navStyle: CSSProperties & { '--segment-index': number } = { '--segment-index': routeIndex };

    return (
        <>
            <header className="topbar">
                <div className="page-width topbar-inner">
                    <div className="brand">
                        <span className="brand-mark" aria-hidden="true">
                            <img src={THEME_ICONS[resolvedTheme]} alt="" />
                        </span>
                        <div className="brand-text">
                            <h1 className="brand-name">The Workbench</h1>
                            <p className="brand-caption">Notes, tasks and ideas</p>
                        </div>
                    </div>
                    <nav className="segmented page-nav" aria-label="Pages">
                        <span className="segment-fill" style={navStyle} aria-hidden="true" />
                        {pages.map(({ route: target, label, icon: Icon, shortcut }) => (
                            <a
                                key={target}
                                href={target}
                                className="segment-button"
                                aria-current={route === target ? 'page' : undefined}
                                aria-keyshortcuts={shortcut}
                                onClick={(event) => {
                                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                                    event.preventDefault();
                                    navigate(target);
                                }}
                            >
                                <Icon size={14} aria-hidden="true" />
                                {label}
                            </a>
                        ))}
                    </nav>
                    <div className="top-actions">
                        {route === '/tasks' ? (
                            <button
                                type="button"
                                className="primary-button control-height"
                                aria-label="New task"
                                onClick={() => setEditingTask({ id: crypto.randomUUID(), taskDate: localDateKey() })}
                            >
                                <Plus size={16} aria-hidden="true" />
                                <span className="button-label">New task</span>
                            </button>
                        ) : route === '/notes' ? (
                            <button
                                type="button"
                                className="primary-button control-height"
                                aria-label="New note"
                                onClick={() => setEditingDate(localDateKey())}
                            >
                                <Plus size={16} aria-hidden="true" />
                                <span className="button-label">New note</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="primary-button control-height"
                                aria-label="New idea"
                                onClick={() => setEditingIdea(null)}
                            >
                                <Plus size={16} aria-hidden="true" />
                                <span className="button-label">New idea</span>
                            </button>
                        )}
                        <button
                            type="button"
                            className="icon-button control-height refresh-button"
                            aria-label={
                                route === '/tasks'
                                    ? 'Refresh tasks'
                                    : route === '/notes'
                                      ? 'Refresh notes'
                                      : 'Refresh ideas'
                            }
                            aria-busy={refreshBusy}
                            data-refreshing={refreshBusy}
                            disabled={refreshBusy}
                            onClick={() => {
                                void refreshAll();
                            }}
                        >
                            <RefreshCw size={16} aria-hidden="true" />
                        </button>
                        <ThemeMenu />
                    </div>
                </div>
            </header>

            <main className="page-width">
                <div className="route-view" data-leaving={leaving}>
                    {onTasks ? (
                        <TasksPage
                            tasks={tasks}
                            today={localDateKey()}
                            editingTask={editingTask}
                            setEditingTask={setEditingTask}
                            syncBadge={syncBadge}
                            onDraftProtectionChange={setProtectedDraft}
                        />
                    ) : onNotes ? (
                        <NotesPage
                            journal={journal}
                            globalNotes={globalNotes}
                            ready={journal.ready}
                            syncBadge={syncBadge}
                            today={localDateKey()}
                            editingDate={editingDate}
                            setEditingDate={setEditingDate}
                            onDraftProtectionChange={setProtectedDraft}
                        />
                    ) : (
                        <IdeasPage
                            sync={sync}
                            solutionsState={solutionsState}
                            ready={ideasReady}
                            syncBadge={syncBadge}
                            editingIdea={editingIdea}
                            setEditingIdea={setEditingIdea}
                            onCreateTask={(title, body) => {
                                if (protectedDraft) return;
                                setEditingTask({
                                    id: crypto.randomUUID(),
                                    taskDate: localDateKey(),
                                    initialTitle: title,
                                    initialBody: body,
                                });
                                navigate('/tasks');
                            }}
                            onDraftProtectionChange={setProtectedDraft}
                        />
                    )}
                </div>
            </main>
        </>
    );
}
