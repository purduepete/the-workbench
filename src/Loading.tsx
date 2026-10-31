import { useEffect, useState } from 'react';

/** True once `isLoading` has lasted `delayMs`, so fast loads never flash a spinner. */
export function useDelayedLoading(isLoading: boolean, delayMs = 250): boolean {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (!isLoading) return;
        const timer = window.setTimeout(() => setVisible(true), delayMs);
        return () => {
            window.clearTimeout(timer);
            setVisible(false);
        };
    }, [isLoading, delayMs]);
    return isLoading && visible;
}

/** Covers the page below the header in the page color and centers the 40px ring after 250ms. */
export function PageLoading({ label }: { label: string }) {
    const show = useDelayedLoading(true);
    return (
        <div className="page-loading">
            {show && (
                <div className="spinner-wrap" role="status">
                    <span className="spinner" aria-hidden="true" />
                    <span className="sr-only">{label}</span>
                </div>
            )}
        </div>
    );
}
