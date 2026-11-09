import { useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

export const EDITOR_SIZE_STORAGE_KEY = 'the-workbench.editor-maximized';

function readMaximized(): boolean {
    try {
        return window.localStorage.getItem(EDITOR_SIZE_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

/** Desktop editors can fill the viewport; the choice is remembered for the next editor in this browser. */
export function useEditorSize() {
    const [maximized, setMaximized] = useState(readMaximized);
    const toggle = () =>
        setMaximized((current) => {
            const next = !current;
            try {
                window.localStorage.setItem(EDITOR_SIZE_STORAGE_KEY, String(next));
            } catch {
                // The size still changes for this editor when storage is unavailable.
            }
            return next;
        });
    return { maximized, toggle };
}

export function EditorSizeToggle({ maximized, onToggle }: { maximized: boolean; onToggle: () => void }) {
    const Icon = maximized ? Minimize2 : Maximize2;
    return (
        <button
            type="button"
            className="icon-button editor-size-toggle"
            aria-label={maximized ? 'Restore editor size' : 'Maximize editor'}
            aria-pressed={maximized}
            onClick={onToggle}
        >
            <Icon size={16} aria-hidden="true" />
        </button>
    );
}
