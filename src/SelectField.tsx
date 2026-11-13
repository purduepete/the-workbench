import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface SelectFieldOption {
    value: string;
    label: string;
    /** A small colored dot beside the label, such as a priority level. */
    dot?: string;
    /** Draws a rule above the option, for an action set apart from the choices. */
    divider?: boolean;
}

interface SelectFieldProps {
    value: string;
    options: SelectFieldOption[];
    onChange: (value: string) => void;
    ariaLabel: string;
    icon?: LucideIcon;
    className?: string;
    /** Quiet text before the value, such as "Status", for chips that have no visible label. */
    prefix?: string;
}

const PANEL_MAX_HEIGHT = 288;
// Fixed and hidden until placed, so the first render cannot reflow (and re-center) a surrounding dialog.
const UNPLACED: CSSProperties = { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };

/**
 * Themed replacement for a native select. The panel uses fixed positioning and is portalled
 * into the nearest open dialog (modal dialogs sit in the top layer) or the body.
 * Focus stays on the trigger; the highlighted option is exposed via aria-activedescendant.
 */
export function SelectField({
    value,
    options,
    onChange,
    ariaLabel,
    icon: Icon,
    className = '',
    prefix,
}: SelectFieldProps) {
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(-1);
    const [position, setPosition] = useState<CSSProperties>(UNPLACED);
    const [portalTarget, setPortalTarget] = useState<Element | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const listboxId = useId();
    const selectedIndex = options.findIndex((option) => option.value === value);
    const selected = options[selectedIndex];

    const close = useCallback(() => setOpen(false), []);
    const openPanel = () => {
        setHighlight(Math.max(0, selectedIndex));
        setPosition(UNPLACED);
        // A modal dialog sits in the top layer, so the panel must render inside it to stay visible.
        setPortalTarget(triggerRef.current?.closest('dialog') ?? document.body);
        setOpen(true);
    };
    const choose = (index: number) => {
        const option = options[index];
        if (option) onChange(option.value);
        setOpen(false);
        triggerRef.current?.focus();
    };

    const place = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const below = window.innerHeight - rect.bottom;
        const openUp = below < Math.min(PANEL_MAX_HEIGHT, 160) && rect.top > below;
        const minWidth = Math.max(rect.width, 180);
        setPosition({
            position: 'fixed',
            left: Math.max(8, Math.min(rect.left, window.innerWidth - minWidth - 8)),
            minWidth,
            maxWidth: window.innerWidth - 16,
            maxHeight: Math.min(PANEL_MAX_HEIGHT, (openUp ? rect.top : below) - 12),
            ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
        });
    }, []);

    useLayoutEffect(() => {
        if (open) place();
    }, [open, place]);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
        };
        const onScroll = (event: Event) => {
            if (!panelRef.current?.contains(event.target as Node)) place();
        };
        document.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', place);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', place);
        };
    }, [open, close, place]);

    useEffect(() => {
        if (open && highlight >= 0) {
            document.getElementById(`${listboxId}-${highlight}`)?.scrollIntoView({ block: 'nearest' });
        }
    }, [open, highlight, listboxId]);

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        const last = options.length - 1;
        if (!open) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
                event.preventDefault();
                openPanel();
            }
            return;
        }
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                setHighlight((index) => Math.min(last, index + 1));
                break;
            case 'ArrowUp':
                event.preventDefault();
                setHighlight((index) => Math.max(0, index - 1));
                break;
            case 'Home':
                event.preventDefault();
                setHighlight(0);
                break;
            case 'End':
                event.preventDefault();
                setHighlight(last);
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                choose(highlight);
                break;
            case 'Escape':
                // Close only the listbox, not a surrounding modal dialog.
                event.preventDefault();
                event.stopPropagation();
                close();
                break;
            case 'Tab':
                close();
                break;
        }
    };

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className={`select-trigger ${className}`}
                onClick={() => (open ? close() : openPanel())}
                onKeyDown={onKeyDown}
                aria-label={`${ariaLabel}: ${selected?.label ?? ''}`}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listboxId : undefined}
                aria-activedescendant={open && highlight >= 0 ? `${listboxId}-${highlight}` : undefined}
            >
                {Icon && <Icon size={15} aria-hidden="true" />}
                {selected?.dot && (
                    <span className="select-dot" style={{ background: selected.dot }} aria-hidden="true" />
                )}
                {prefix && <span className="select-prefix">{prefix}</span>}
                <span className="select-label">{selected?.label ?? ariaLabel}</span>
                <ChevronDown size={14} aria-hidden="true" className={open ? 'select-chevron open' : 'select-chevron'} />
            </button>
            {open &&
                portalTarget &&
                createPortal(
                    <div
                        ref={panelRef}
                        id={listboxId}
                        role="listbox"
                        aria-label={ariaLabel}
                        className="select-panel"
                        style={position}
                    >
                        {options.map((option, index) => {
                            const active = option.value === value;
                            return (
                                <div
                                    key={option.value}
                                    id={`${listboxId}-${index}`}
                                    role="option"
                                    aria-selected={active}
                                    className={`select-option${index === highlight ? ' highlighted' : ''}${active ? ' active' : ''}${option.divider ? ' divided' : ''}`}
                                    onPointerDown={(event) => event.preventDefault()}
                                    onPointerEnter={() => setHighlight(index)}
                                    onClick={() => choose(index)}
                                >
                                    <span className="select-check">
                                        {active && <Check size={14} aria-hidden="true" />}
                                    </span>
                                    {option.dot && (
                                        <span
                                            className="select-dot"
                                            style={{ background: option.dot }}
                                            aria-hidden="true"
                                        />
                                    )}
                                    <span>{option.label}</span>
                                </div>
                            );
                        })}
                    </div>,
                    portalTarget
                )}
        </>
    );
}
