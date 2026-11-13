import { useEffect, useId, useRef, useState } from 'react';
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
    children,
}: CommentaryAsideProps) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [width, setWidth] = useState(readWidth);
    const [error, setError] = useState<string | null>(null);
    const layoutRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const modeRef = useRef<HTMLButtonElement>(null);
    const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null);
    const dragged = useRef(false);
    const paneId = `commentary-${useId()}`;

    useEffect(() => {
        if (editing) inputRef.current?.focus({ preventScroll: true });
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

    const toggle = () => {
        if (open) {
            if (editing) showView();
            setOpen(false);
            return;
        }
        setOpen(true);
        if (comment) setEditing(false);
        else startEditing();
    };

    /** Dragging the bar left by some distance widens the pane by the same distance. */
    const sizeTo = (clientX: number, start: { x: number; width: number }) => {
        const rect = layoutRef.current?.getBoundingClientRect();
        const max = Math.max(MIN_WIDTH, (rect?.width ?? 1000) * 0.7);
        setWidth(Math.min(max, Math.max(MIN_WIDTH, start.width + start.x - clientX)));
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
            if (!open) {
                setOpen(true);
                if (comment) setEditing(false);
                else startEditing();
            }
        }
        sizeTo(event.clientX, state);
    };

    const onPointerUp = () => {
        if (drag.current?.moved) {
            dragged.current = true;
            setWidth((value) => {
                writeWidth(value);
                return value;
            });
        }
        drag.current = null;
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
            aria-expanded={open}
            aria-controls={open ? paneId : undefined}
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
    return (
        <div
            ref={layoutRef}
            className="commentary-layout"
            data-open={open}
            data-anchor={anchor}
            style={{ '--commentary-width': `${width}px` } as CSSProperties}
        >
            <div className="commentary-main">
                {children}
                {anchor === 'heading' && rail}
            </div>
            {anchor === 'edge' && rail}
            {open && (
                <aside id={paneId} className="commentary-pane" aria-label={`Commentary for ${label}`}>
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
