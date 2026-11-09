import { useEffect, useRef } from 'react';

/**
 * Expands details after a 1 second hover on mouse and trackpad devices. The expansion stays until the user
 * collapses it with Show less; leaving the content only cancels an expansion that has not happened yet.
 */
export function useDetailsHover(onExpand: () => void) {
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const cancel = () => {
        clearTimeout(timer.current);
        timer.current = undefined;
    };
    useEffect(() => () => clearTimeout(timer.current), []);
    return {
        onPointerEnter: () => {
            cancel();
            if (matchMedia('(hover: hover)').matches) timer.current = setTimeout(onExpand, 1000);
        },
        // A click (ticking a checklist box, opening a link) means acting, not reading: don't expand.
        onPointerDown: cancel,
        onPointerLeave: cancel,
    };
}
