import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, MessageSquare, Pencil, Trash2, X } from 'lucide-react';
import { commentLimits } from '../shared/contracts';
import type { NoteComment } from './commentsSync';
import { formatIdeaTimestamp } from './ideas';
import { MarkdownNoteBody } from './MarkdownNote';

interface NoteCommentsProps {
    noteId: string;
    heading: string;
    comments: NoteComment[];
    onSave: (comment: { id: string; noteId: string; body: string }) => string | null;
    onRemove: (id: string) => string | null;
}

/** Ctrl or Cmd + Enter submits a comment box; Escape cancels an edit. */
const submitKey = (event: KeyboardEvent<HTMLTextAreaElement>) =>
    event.key === 'Enter' && (event.ctrlKey || event.metaKey);

/** Dated follow-up comments under a daily note, added and edited without opening the note editor. */
export function NoteComments({ noteId, heading, comments, onSave, onRemove }: NoteCommentsProps) {
    const [draft, setDraft] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const addRef = useRef<HTMLTextAreaElement>(null);

    const add = () => {
        const body = draft.trim();
        if (!body) {
            addRef.current?.focus();
            return;
        }
        const result = onSave({ id: window.crypto.randomUUID(), noteId, body });
        setError(result);
        if (!result) setDraft('');
    };

    const saveEdit = (comment: NoteComment) => {
        const body = editText.trim();
        if (!body) {
            setError('A comment needs text. Use Delete to remove it.');
            return;
        }
        const result = body === comment.body ? null : onSave({ id: comment.id, noteId, body });
        setError(result);
        if (!result) setEditingId(null);
    };

    const remove = (id: string) => {
        if (confirmingId !== id) {
            setConfirmingId(id);
            return;
        }
        setConfirmingId(null);
        setError(onRemove(id));
    };

    return (
        <section className="note-comments" aria-label={`Comments on ${heading}`}>
            <h6 className="note-comments-heading">
                <MessageSquare size={12} aria-hidden="true" />
                Comments{comments.length > 0 ? ` (${comments.length})` : ''}
            </h6>
            {comments.length > 0 && (
                <ol className="note-comment-list">
                    {comments.map((comment) => (
                        <li key={comment.id} className="note-comment">
                            <div className="note-comment-meta">
                                <time dateTime={comment.createdAt}>{formatIdeaTimestamp(comment.createdAt)}</time>
                                {editingId !== comment.id && (
                                    <span className="note-comment-actions">
                                        <button
                                            type="button"
                                            className="card-action"
                                            aria-label={`Edit comment from ${formatIdeaTimestamp(comment.createdAt)}`}
                                            onClick={() => {
                                                setEditingId(comment.id);
                                                setEditText(comment.body);
                                                setError(null);
                                            }}
                                        >
                                            <Pencil size={12} aria-hidden="true" />
                                        </button>
                                        <button
                                            type="button"
                                            className="card-action"
                                            data-confirming={confirmingId === comment.id}
                                            aria-label={
                                                confirmingId === comment.id
                                                    ? 'Confirm delete comment'
                                                    : `Delete comment from ${formatIdeaTimestamp(comment.createdAt)}`
                                            }
                                            onClick={() => remove(comment.id)}
                                            onBlur={() => setConfirmingId(null)}
                                        >
                                            <Trash2 size={12} aria-hidden="true" />
                                            {confirmingId === comment.id && <span>Confirm</span>}
                                        </button>
                                    </span>
                                )}
                            </div>
                            {editingId === comment.id ? (
                                <div className="note-comment-form">
                                    <label className="sr-only" htmlFor={`comment-edit-${comment.id}`}>
                                        Edit comment
                                    </label>
                                    <textarea
                                        id={`comment-edit-${comment.id}`}
                                        className="field-input note-comment-input"
                                        rows={3}
                                        maxLength={commentLimits.body}
                                        value={editText}
                                        autoFocus
                                        onChange={(event) => setEditText(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (submitKey(event)) {
                                                event.preventDefault();
                                                saveEdit(comment);
                                            } else if (event.key === 'Escape') {
                                                event.preventDefault();
                                                setEditingId(null);
                                            }
                                        }}
                                    />
                                    <div className="note-comment-buttons">
                                        <button
                                            type="button"
                                            className="secondary-button"
                                            onClick={() => setEditingId(null)}
                                        >
                                            <X size={14} aria-hidden="true" />
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            className="primary-button"
                                            onClick={() => saveEdit(comment)}
                                        >
                                            <Check size={14} aria-hidden="true" />
                                            Save comment
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <MarkdownNoteBody body={comment.body} className="note-comment-body markdown-body" />
                            )}
                        </li>
                    ))}
                </ol>
            )}
            <div className="note-comment-form">
                <label className="sr-only" htmlFor={`comment-add-${noteId}`}>
                    Add a comment to {heading}
                </label>
                <textarea
                    id={`comment-add-${noteId}`}
                    ref={addRef}
                    className="field-input note-comment-input"
                    rows={2}
                    maxLength={commentLimits.body}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (!submitKey(event)) return;
                        event.preventDefault();
                        add();
                    }}
                />
                <div className="note-comment-buttons">
                    <button type="button" className="primary-button" disabled={!draft.trim()} onClick={add}>
                        <Check size={14} aria-hidden="true" />
                        Add comment
                    </button>
                </div>
            </div>
            {error && (
                <p className="dialog-error" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
