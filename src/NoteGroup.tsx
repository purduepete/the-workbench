import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function NoteGroup({
    id,
    title,
    count,
    item,
    isGlobal = false,
    defaultExpanded = false,
    expanded,
    onExpandedChange,
    children,
}: {
    id: string;
    title: string;
    count: number;
    item: 'note' | 'entry' | 'task';
    isGlobal?: boolean;
    defaultExpanded?: boolean;
    expanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
    children: ReactNode;
}) {
    const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
    const open = expanded ?? localExpanded;
    const countLabel = count === 1 ? item : item === 'entry' ? 'entries' : `${item}s`;
    return (
        <section className={isGlobal ? 'journal-week global-notes-section' : 'journal-week'} aria-label={title}>
            <div className="content-heading note-group-heading">
                <h3>
                    <button
                        type="button"
                        className="note-group-toggle"
                        aria-label={title}
                        aria-describedby={`${id}-count`}
                        aria-expanded={open}
                        aria-controls={`${id}-list`}
                        onClick={() => {
                            setLocalExpanded(!open);
                            onExpandedChange?.(!open);
                        }}
                    >
                        <span className="note-group-label">
                            {open ? (
                                <ChevronDown size={16} aria-hidden="true" />
                            ) : (
                                <ChevronRight size={16} aria-hidden="true" />
                            )}
                            {title}
                        </span>
                        <span className="result-count" id={`${id}-count`}>
                            {count} {countLabel}
                        </span>
                    </button>
                </h3>
            </div>
            <div className="journal-list" id={`${id}-list`} hidden={!open}>
                {children}
            </div>
        </section>
    );
}
