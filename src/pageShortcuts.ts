import type { Route } from './useRoute';

const SHORTCUTS: Record<string, Route> = { i: '/ideas', n: '/notes', t: '/tasks' };

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'repeat' | 'defaultPrevented'> & {
    target: EventTarget | null;
};

const isEditable = (target: EventTarget | null) => {
    const closest = (target as Partial<Element> | null)?.closest;
    return (
        typeof closest === 'function' &&
        Boolean(
            closest.call(
                target,
                'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="listbox"]'
            )
        )
    );
};

/** The page an I, N or T key press opens, or null while typing, in a dialog, or with a modifier held. */
export function shortcutRoute(event: ShortcutEvent, doc: Pick<Document, 'querySelector'> = document): Route | null {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return null;
    const route = SHORTCUTS[event.key.toLowerCase()];
    if (!route || isEditable(event.target)) return null;
    if (doc.querySelector('dialog[open], [role="dialog"]:not([hidden])')) return null;
    return route;
}
