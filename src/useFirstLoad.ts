import { useLayoutEffect } from 'react';

/** A saved cache is already ready; refreshes never replay the shell entrance. */
export function useFirstLoad(ready: boolean, failed: boolean) {
    useLayoutEffect(() => {
        const root = document.documentElement;
        if (root.dataset.firstLoad !== 'pending' || (!ready && !failed)) return;
        root.dataset.firstLoad = failed ? 'error' : 'ready';
        if (!failed) {
            document.querySelector('.data-enter')?.classList.add('first-load-content');
            window.setTimeout(() => {
                if (root.dataset.firstLoad === 'ready') root.dataset.firstLoad = 'complete';
            }, 600);
        }
    }, [ready, failed]);
}
