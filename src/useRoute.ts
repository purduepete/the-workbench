import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type Route = '/' | '/notes' | '/tasks';

const readRoute = (): Route =>
    window.location.pathname === '/tasks' ? '/tasks' : window.location.pathname === '/notes' ? '/notes' : '/';

/** Page links use pushState and back/forward use popstate, with a shared draft guard. */
export function useRoute(canNavigate: () => boolean = () => true): [Route, (next: Route) => void] {
    const [route, setRoute] = useState(readRoute);
    const routeRef = useRef(route);
    const guardRef = useRef(canNavigate);

    useLayoutEffect(() => {
        routeRef.current = route;
        guardRef.current = canNavigate;
    }, [route, canNavigate]);

    useEffect(() => {
        const onPopState = () => {
            if (!guardRef.current()) {
                window.history.pushState(null, '', routeRef.current);
                return;
            }
            const next = readRoute();
            routeRef.current = next;
            setRoute(next);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    const navigate = useCallback((next: Route) => {
        if (next === routeRef.current || !guardRef.current()) return;
        window.history.pushState(null, '', next);
        routeRef.current = next;
        setRoute(next);
    }, []);

    return [route, navigate];
}
