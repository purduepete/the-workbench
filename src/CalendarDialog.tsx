import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatEntryDate, localDateKey } from './journal';

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

    return (
        <dialog
            ref={dialogRef}
            className="dialog-backdrop calendar-dialog"
            aria-labelledby="calendar-title"
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClick={(event) => {
                if (event.target === dialogRef.current) onClose();
            }}
        >
            <div className="idea-form">
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
                        const inMonth =
                            day.slice(0, 7) ===
                            `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
                        return (
                            <button
                                key={day}
                                ref={(element) => {
                                    if (element) dayRefs.current.set(day, element);
                                    else dayRefs.current.delete(day);
                                }}
                                type="button"
                                className="calendar-day"
                                data-outside-month={!inMonth}
                                data-has-entry={entryDays.has(day)}
                                data-today={day === today}
                                aria-label={formatEntryDate(day)}
                                aria-pressed={selected === day}
                                onClick={() => setSelected(day)}
                                onDoubleClick={() => onSelect(day)}
                                onKeyDown={(event) => {
                                    const move =
                                        event.key === 'ArrowLeft'
                                            ? -1
                                            : event.key === 'ArrowRight'
                                              ? 1
                                              : event.key === 'ArrowUp'
                                                ? -7
                                                : event.key === 'ArrowDown'
                                                  ? 7
                                                  : 0;
                                    if (!move) return;
                                    event.preventDefault();
                                    const next = shiftDay(day, move);
                                    const [year, monthNumber] = next.split('-').map(Number);
                                    if (year !== month.getFullYear() || monthNumber - 1 !== month.getMonth())
                                        setMonth(new Date(year, monthNumber - 1, 1, 12));
                                    setSelected(next);
                                    setFocusDate(next);
                                }}
                                onKeyUp={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') onSelect(day);
                                }}
                            >
                                {Number(day.slice(-2))}
                                {entryDays.has(day) && <span className="calendar-entry-dot" aria-hidden="true" />}
                            </button>
                        );
                    })}
                </div>
                <div className="dialog-footer calendar-footer">
                    <button type="button" className="secondary-button" onClick={onClose}>
                        Cancel
                    </button>
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
                    <button type="button" className="primary-button" onClick={() => onSelect(selected)}>
                        Open {formatEntryDate(selected)}
                    </button>
                </div>
            </div>
        </dialog>
    );
}
