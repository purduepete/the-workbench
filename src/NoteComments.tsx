import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { commentLimits } from '../shared/contracts';
import type { NoteComment } from './commentsSync';
import { MarkdownNoteBody } from './MarkdownNote';

const WIDTH_KEY = 'the-workbench.commentary-width';
const MIN_WIDTH = 200;
const STEP = 32;

type SaveComment = (comment: { id: string; noteId: string; body: string }) => string | null;

function readWidth(): number {
    try {
        const saved = Number(window.localStorage.getItem(WIDTH_KEY));
        return Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : 320;
    } catch {
        return 320;
    }
}

function writeWidth(width: number) {
    try {
        window.localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    } catch {
        // The width still applies for this page; it just won't be remembered.
    }
}

const stacked = () => window.matchMedia('(max-width: 760px)').matches;

interface CommentaryAsideProps {
    /** The section heading, or the note heading when the commentary belongs to the whole note. */
    label: string;
    id: string;
    noteId: string;
    comment: NoteComment | undefined;
    onSave: SaveComment;
    onRemove: (id: string) => string | null;
    /** `heading` puts the bar in a section heading, just left of its arrow; `edge` puts it at the content's upper right. */
    anchor?: 'heading' | 'edge';
    /** Whether the section this commentary belongs to is expanded; omitted for a note without sections. */
    sectionExpanded?: boolean;
    onSectionExpand?: (expanded: boolean) => void;
    children: ReactNode;
}

/**
 * Content with a short bar in its upper right. Clicking the bar opens Markdown commentary beside the content, or below
 * it on a phone; dragging it sets the pane width. A quiet pencil or eye in the pane's corner switches edit and view.
 */
export function CommentaryAside({
    label,
    id,
    noteId,
    comment,
    onSave,
    onRemove,
    anchor = 'edge',
    sectionExpanded,
    onSectionExpand,
    children,
}: CommentaryAsideProps) {
    const [open, setOpen] = useState(false);
    // A closing pane stays mounted until its fade-out ends.
    const [closing, setClosing] = useState(false);
    const closeTimer = useRef(0);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [width, setWidth] = useState(readWidth);
    const [error, setError] = useState<string | null>(null);
    const layoutRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const modeRef = useRef<HTMLButtonElement>(null);
    const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null);
    const dragged = useRef(false);
    const dragFrame = useRef(0);
    const pendingWidth = useRef<number | null>(null);
    const paneId = `commentary-${useId()}`;
    const [sectionHeight, setSectionHeight] = useState<number | null>(null);

    // An open bar matches the height of its comment, whether the section is expanded or collapsed.
    useLayoutEffect(() => {
        const layout = layoutRef.current;
        if (!open || anchor !== 'heading' || !layout) {
            setSectionHeight(null);
            return;
        }
        const pane = layout.querySelector(':scope > .commentary-pane');
        if (!pane) return;
        let frame = 0;
        const measure = () => setSectionHeight(Math.round(pane.getBoundingClientRect().height));
        measure();
        // One update per frame, so the bar follows the comment without jitter while text reflows.
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
        });
        observer.observe(pane);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [open, anchor]);

    // A newly opened pane takes focus after its reveal, so focusing the editor never stalls the animation.
    const revealing = useRef(false);
    useEffect(() => {
        if (editing && !revealing.current) inputRef.current?.focus({ preventScroll: true });
    }, [editing]);

    const commit = () => {
        const body = draft.trim();
        if (body === (comment?.body ?? '')) return;
        const result = body ? onSave({ id, noteId, body }) : comment ? onRemove(id) : null;
        setError(result);
    };

    const startEditing = () => {
        setDraft(comment?.body ?? '');
        setError(null);
        setEditing(true);
    };

    const showView = () => {
        commit();
        setEditing(false);
    };

    const finishClose = () => {
        window.clearTimeout(closeTimer.current);
        setClosing(false);
        setOpen(false);
        setEditing(false);
    };

    useEffect(() => () => window.clearTimeout(closeTimer.current), []);

    const openPane = () => {
        if (closing) {
            window.clearTimeout(closeTimer.current);
            setClosing(false);
            return;
        }
        if (open) return;
        revealing.current = true;
        setOpen(true);
        if (comment) setEditing(false);
        else startEditing();
        // Opening a comment opens its section too.
        if (sectionExpanded === false) onSectionExpand?.(true);
    };

    const closePane = () => {
        if (!open || closing) return;
        // Save now, but keep the editor showing until the fade-out ends.
        if (editing) commit();
        setClosing(true);
        // Backstop in case the animation never runs, such as a hidden tab.
        closeTimer.current = window.setTimeout(finishClose, 500);
    };

    const toggle = () => (open && !closing ? closePane() : openPane());

    // Expanding a section opens its saved comment, and collapsing it closes the comment.
    const onSectionChange = useEffectEvent((expanded: boolean) => {
        if (!expanded) closePane();
        else if (comment) openPane();
    });
    const lastExpanded = useRef(sectionExpanded);
    useEffect(() => {
        if (sectionExpanded === undefined || sectionExpanded === lastExpanded.current) return;
        lastExpanded.current = sectionExpanded;
        onSectionChange(sectionExpanded);
    }, [sectionExpanded]);

    /** Dragging the bar left by some distance widens the pane by the same distance. */
    const sizeTo = (clientX: number, start: { x: number; width: number }) => {
        const rect = layoutRef.current?.getBoundingClientRect();
        const max = Math.max(MIN_WIDTH, (rect?.width ?? 1000) * 0.7);
        const next = Math.min(max, Math.max(MIN_WIDTH, start.width + start.x - clientX));
        pendingWidth.current = next;
        cancelAnimationFrame(dragFrame.current);
        dragFrame.current = requestAnimationFrame(() => setWidth(next));
    };

    const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || stacked()) return;
        drag.current = { x: event.clientX, width, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
        const state = drag.current;
        if (!state) return;
        if (!state.moved && Math.abs(event.clientX - state.x) < 5) return;
        if (!state.moved) {
            state.moved = true;
            openPane();
        }
        sizeTo(event.clientX, state);
    };

    const onPointerUp = () => {
        if (drag.current?.moved) {
            dragged.current = true;
            // Apply the last drag position now, so the saved width is the one under the pointer.
            cancelAnimationFrame(dragFrame.current);
            const final = pendingWidth.current;
            if (final !== null) {
                setWidth(final);
                writeWidth(final);
            }
        }
        drag.current = null;
        pendingWidth.current = null;
    };

    const onRailKey = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!open || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        const rect = layoutRef.current?.getBoundingClientRect();
        const max = Math.max(MIN_WIDTH, (rect?.width ?? 1000) * 0.7);
        setWidth((value) => {
            const next = Math.min(max, Math.max(MIN_WIDTH, value + (event.key === 'ArrowLeft' ? STEP : -STEP)));
            writeWidth(next);
            return next;
        });
    };

    const state = comment ? 'Commentary' : 'Add commentary';
    const rail = (
        <button
            type="button"
            className="commentary-rail"
            data-has-commentary={Boolean(comment)}
            aria-label={`${state} for ${label}`}
            aria-expanded={open && !closing}
            aria-controls={open && !closing ? paneId : undefined}
            onClick={() => {
                if (dragged.current) {
                    dragged.current = false;
                    return;
                }
                toggle();
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={onRailKey}
        >
            <span className="commentary-rail-bar" aria-hidden="true" />
        </button>
    );
    // The dot stays in place to close the comment, so resizing moves to its own grabber.
    const grip = open && (
        <button
            type="button"
            className="commentary-grip"
            aria-label={`Resize commentary for ${label}`}
            onClick={() => (dragged.current = false)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={onRailKey}
        >
            <span className="commentary-grip-dots" aria-hidden="true" />
        </button>
    );
    return (
        <div
            ref={layoutRef}
            className="commentary-layout"
            data-open={open}
            data-anchor={anchor}
            style={
                {
                    '--commentary-width': `${width}px`,
                    ...(sectionHeight === null ? {} : { '--section-height': `${sectionHeight}px` }),
                } as CSSProperties
            }
        >
            <div className="commentary-main">
                {children}
                {anchor === 'heading' && rail}
            </div>
            {anchor === 'edge' && rail}
            {grip}
            {open && (
                <aside
                    id={paneId}
                    className="commentary-pane"
                    data-closing={closing || undefined}
                    aria-label={`Commentary for ${label}`}
                    onAnimationEnd={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (closing) finishClose();
                        else if (revealing.current) {
                            revealing.current = false;
                            if (editing) inputRef.current?.focus({ preventScroll: true });
                        }
                    }}
                >
                    <button
                        ref={modeRef}
                        type="button"
                        className="commentary-mode"
                        aria-label={editing ? 'View commentary' : 'Edit commentary'}
                        onClick={() => (editing ? showView() : startEditing())}
                    >
                        {editing ? <Eye size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
                    </button>
                    {editing ? (
                        <>
                            <label className="sr-only" htmlFor={`${paneId}-input`}>
                                Commentary for {label}
                            </label>
                            <textarea
                                id={`${paneId}-input`}
                                ref={inputRef}
                                className="field-input commentary-input"
                                maxLength={commentLimits.body}
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                onBlur={(event) => {
                                    // The eye button saves on its own click; anything else saves on the way out.
                                    if (event.relatedTarget !== modeRef.current) commit();
                                }}
                                onKeyDown={(event) => {
                                    if (
                                        event.key === 'Escape' ||
                                        (event.key === 'Enter' && (event.ctrlKey || event.metaKey))
                                    ) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        showView();
                                        modeRef.current?.focus();
                                    }
                                }}
                            />
                        </>
                    ) : comment ? (
                        <MarkdownNoteBody body={comment.body} className="markdown-body commentary-body" />
                    ) : (
                        <p className="commentary-empty">No commentary yet.</p>
                    )}
                    {error && (
                        <p className="dialog-error" role="alert">
                            {error}
                        </p>
                    )}
                </aside>
            )}
        </div>
    );
}

/** Commentary whose section heading was renamed or removed, kept until it is deleted. */
export function DetachedCommentary({
    comments,
    onRemove,
}: {
    comments: NoteComment[];
    onRemove: (id: string) => string | null;
}) {
    const [confirming, setConfirming] = useState<string | null>(null);
    if (comments.length === 0) return null;
    return (
        <section className="commentary-detached" aria-label="Commentary from renamed sections">
            <h6 className="commentary-detached-heading">Commentary from renamed sections</h6>
            {comments.map((comment) => (
                <div key={comment.id} className="commentary-detached-item">
                    <MarkdownNoteBody body={comment.body} className="markdown-body commentary-body" />
                    <button
                        type="button"
                        className="commentary-mode commentary-detached-delete"
                        aria-label={confirming === comment.id ? 'Confirm delete commentary' : 'Delete commentary'}
                        data-confirming={confirming === comment.id}
                        onClick={() => {
                            if (confirming !== comment.id) {
                                setConfirming(comment.id);
                                return;
                            }
                            setConfirming(null);
                            onRemove(comment.id);
                        }}
                        onBlur={() => setConfirming(null)}
                    >
                        <Trash2 size={14} aria-hidden="true" />
                    </button>
                </div>
            ))}
        </section>
    );
}
