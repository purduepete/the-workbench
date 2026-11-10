import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatEntryDate, localDateKey } from './journal';
import { DialogCloseButton } from './DialogClose';

function monthDays(month: Date): string[] {
    const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        return localDateKey(date);
    });
}

const arrowSteps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

function shiftDay(day: string, amount: number): string {
    const [year, month, date] = day.split('-').map(Number);
    const result = new Date(year, month - 1, date, 12);
    result.setDate(result.getDate() + amount);
    return localDateKey(result);
}

export function CalendarDialog({
    entries,
    today,
    onSelect,
    onClose,
    label = 'Daily notes',
}: {
    entries: string[];
    today: string;
    onSelect: (date: string) => void;
    onClose: () => void;
    label?: string;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const dayRefs = useRef(new Map<string, HTMLButtonElement>());
    const initial = today.split('-').map(Number);
    const [month, setMonth] = useState(() => new Date(initial[0], initial[1] - 1, 1, 12));
    const [selected, setSelected] = useState(today);
    const [focusDate, setFocusDate] = useState(today);
    const days = useMemo(() => monthDays(month), [month]);
    const entryDays = useMemo(() => new Set(entries), [entries]);

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const returnFocus = returnFocusRef.current;
        if (dialog && !dialog.open) dialog.showModal();
        return () => {
            if (dialog?.open) dialog.close();
            if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        };
    }, []);

    useLayoutEffect(() => {
        dayRefs.current.get(focusDate)?.focus({ preventScroll: true });
    }, [days, focusDate]);

    const moveMonth = (amount: number) => {
        setMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1, 12));
    };
    const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    const goToDay = (next: string) => {
        const [year, monthNumber] = next.split('-').map(Number);
        if (year !== month.getFullYear() || monthNumber - 1 !== month.getMonth())
            setMonth(new Date(year, monthNumber - 1, 1, 12));
        setSelected(next);
        setFocusDate(next);
        dayRefs.current.get(next)?.focus({ preventScroll: true });
    };

    return (
        <dialog
            ref={dialogRef}
            className="dialog-backdrop calendar-dialog"
            aria-labelledby="calendar-title"
            tabIndex={-1}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClick={(event) => {
                if (event.target === dialogRef.current) onClose();
            }}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                    return;
                }
                const step = arrowSteps[event.key];
                if (!step) return;
                // Arrows always move between days, even when focus is on the month buttons or the dialog itself.
                event.preventDefault();
                const from =
                    event.target instanceof HTMLElement
                        ? event.target.closest<HTMLElement>('.calendar-day')?.dataset.day
                        : undefined;
                const start = from ?? (selected.startsWith(monthKey) ? selected : null);
                goToDay(start ? shiftDay(start, step) : `${monthKey}-01`);
            }}
        >
            <div className="idea-form">
                <div className="dialog-corner-actions">
                    <DialogCloseButton onClose={onClose} />
                </div>
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">{label}</p>
                        <h2 id="calendar-title">Choose a day</h2>
                    </div>
                </div>
                <div className="calendar-month">
                    <button
                        type="button"
                        className="icon-button"
                        aria-label="Previous month"
                        onClick={() => moveMonth(-1)}
                    >
                        <ChevronLeft size={17} aria-hidden="true" />
                    </button>
                    <strong aria-live="polite">
                        {String(month.getMonth() + 1).padStart(2, '0')}/{month.getFullYear()}
                    </strong>
                    <button type="button" className="icon-button" aria-label="Next month" onClick={() => moveMonth(1)}>
                        <ChevronRight size={17} aria-hidden="true" />
                    </button>
                </div>
                <div className="calendar-weekdays" aria-hidden="true">
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
                        <span key={`${day}-${index}`}>{day}</span>
                    ))}
                </div>
                <div className="calendar-grid" aria-label="Calendar days">
                    {days.map((day) => {
                        const inMonth = day.slice(0, 7) === monthKey;
                        return (
                            <button
                                key={day}
                                ref={(element) => {
                                    if (element) dayRefs.current.set(day, element);
                                    else dayRefs.current.delete(day);
                                }}
                                type="button"
                                className="calendar-day"
                                data-day={day}
                                data-outside-month={!inMonth}
                                data-has-entry={entryDays.has(day)}
                                data-today={day === today}
                                aria-label={formatEntryDate(day)}
                                aria-pressed={selected === day}
                                onClick={() => onSelect(day)}
                            >
                                {Number(day.slice(-2))}
                                {entryDays.has(day) && <span className="calendar-entry-dot" aria-hidden="true" />}
                            </button>
                        );
                    })}
                </div>
                <div className="dialog-footer calendar-footer">
                    <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                            const [year, monthNumber] = today.split('-').map(Number);
                            setMonth(new Date(year, monthNumber - 1, 1, 12));
                            setSelected(today);
                            setFocusDate(today);
                        }}
                    >
                        <CalendarDays size={15} aria-hidden="true" />
                        Today
                    </button>
                </div>
            </div>
        </dialog>
    );
}
