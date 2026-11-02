import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Palette } from 'lucide-react';
import { useTheme } from './ThemeContext';
import type { ThemePreference } from './types';

const themeOptions: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'midnight', label: 'Midnight' },
    { value: 'system', label: 'System' },
];

export function ThemeMenu() {
    const { preference, setPreference } = useTheme();
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const pressingTrigger = useRef(false);
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const preferenceIndex = themeOptions.findIndex((option) => option.value === preference);
    const selectedLabel = themeOptions[preferenceIndex]?.label ?? 'Theme';

    useEffect(() => {
        if (!open) return;
        optionRefs.current[preferenceIndex]?.focus();
        const handlePointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [open, preferenceIndex]);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
            return;
        }
        const currentIndex = optionRefs.current.findIndex((option) => option === document.activeElement);
        let nextIndex: number | undefined;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            nextIndex = (currentIndex + 1) % themeOptions.length;
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
            nextIndex = (currentIndex - 1 + themeOptions.length) % themeOptions.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = themeOptions.length - 1;
        }
        if (nextIndex === undefined) return;
        event.preventDefault();
        const next = themeOptions[nextIndex];
        if (!next) return;
        setPreference(next.value);
        optionRefs.current[nextIndex]?.focus();
    };

    return (
        <div
            ref={wrapperRef}
            className="theme-wrap"
            onBlur={(event) => {
                if (pressingTrigger.current) return;
                const nextTarget = event.relatedTarget;
                if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setOpen(false);
            }}
        >
            <button
                ref={triggerRef}
                type="button"
                className="icon-button control-height"
                aria-label={`Theme: ${selectedLabel}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls="theme-picker-popover"
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    pressingTrigger.current = true;
                    event.preventDefault();
                }}
                onPointerCancel={() => {
                    pressingTrigger.current = false;
                }}
                onClick={() => {
                    pressingTrigger.current = false;
                    if (open) {
                        setOpen(false);
                        triggerRef.current?.focus();
                    } else {
                        setOpen(true);
                    }
                }}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
            >
                <Palette size={17} aria-hidden="true" />
            </button>
            <div
                className="theme-picker-popover"
                id="theme-picker-popover"
                role="dialog"
                aria-label="Appearance settings"
                hidden={!open}
                onKeyDown={handleKeyDown}
            >
                <span className="theme-popover-label">Theme</span>
                <div className="theme-picker-options" role="radiogroup" aria-label="Theme">
                    <span
                        className="theme-selection"
                        aria-hidden="true"
                        style={{ '--theme-index': preferenceIndex } as CSSProperties}
                    />
                    {themeOptions.map(({ value, label }, index) => (
                        <button
                            key={value}
                            ref={(element) => {
                                optionRefs.current[index] = element;
                            }}
                            type="button"
                            role="radio"
                            aria-checked={preference === value}
                            tabIndex={preference === value ? 0 : -1}
                            onClick={() => setPreference(value)}
                        >
                            <span>{label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
