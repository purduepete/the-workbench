import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ThemePreference } from './types';

const THEME_STORAGE_KEY = 'idea-notes.theme-preference';
// Safari can clear localStorage after the Cloudflare Access sign-in, so the server also keeps the choice in a cookie.
const THEME_COOKIE_PATTERN = /(?:^|; )idea-notes\.theme=(system|light|midnight)(?:;|$)/;
const THEME_BACKGROUNDS: Record<'light' | 'midnight', string> = {
    light: '#ffffff',
    midnight: '#020617',
};

interface ThemeContextValue {
    preference: ThemePreference;
    resolvedTheme: 'light' | 'midnight';
    storageWarning: string | null;
    setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isPreference(value: string | null | undefined): value is ThemePreference {
    return value === 'light' || value === 'midnight' || value === 'system';
}

function readPreference(): { preference: ThemePreference; warning: string | null } {
    const cookie = document.cookie.match(THEME_COOKIE_PATTERN)?.[1];
    try {
        const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (isPreference(saved)) return { preference: saved, warning: null };
        return { preference: isPreference(cookie) ? cookie : 'midnight', warning: null };
    } catch {
        return {
            preference: isPreference(cookie) ? cookie : 'midnight',
            warning: 'The theme preference could not be read from browser storage.',
        };
    }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [initial] = useState(readPreference);
    const [preference, setPreferenceState] = useState(initial.preference);
    const [storageWarning, setStorageWarning] = useState(initial.warning);
    const [systemDark, setSystemDark] = useState(
        () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
    );
    const resolvedTheme = preference === 'system' ? (systemDark ? 'midnight' : 'light') : preference;

    useEffect(() => {
        const root = document.documentElement;
        root.classList.remove('light', 'dark', 'theme-midnight');
        if (resolvedTheme === 'light') {
            root.classList.add('light');
        } else {
            root.classList.add('dark', 'theme-midnight');
        }
        root.style.colorScheme = resolvedTheme === 'light' ? 'light' : 'dark';
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BACKGROUNDS[resolvedTheme]);
    }, [resolvedTheme]);

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
        media.addEventListener('change', handleChange);
        return () => media.removeEventListener('change', handleChange);
    }, []);

    const setPreference = (next: ThemePreference) => {
        setPreferenceState(next);
        // Best effort: offline or in local dev without the server, localStorage still holds the choice.
        void fetch('/api/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: next }),
        }).catch(() => undefined);
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, next);
            setStorageWarning(null);
        } catch {
            setStorageWarning('The theme changed, but browser storage could not save your preference.');
        }
    };

    const value = useMemo(
        () => ({ preference, resolvedTheme, storageWarning, setPreference }),
        [preference, resolvedTheme, storageWarning]
    );
    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) throw new Error('useTheme must be used within ThemeProvider');
    return context;
}
