import type { CSSProperties } from 'react';
import type { NoteCategory } from '../shared/contracts';

/** A note is Home or Work (dated daily notes) or Global (no date). */
export type NoteKind = 'home' | 'work' | 'global';
export type NoteFilter = NoteKind;

const LABELS: Record<NoteKind, string> = { global: 'Global', home: 'Home', work: 'Work' };

/** Daily notes saved before Home and Work were required have no category; they read as Home. */
export const kindOf = (category: NoteCategory | undefined): Exclude<NoteKind, 'global'> =>
    category === 'work' ? 'work' : 'home';
export const categoryLabel = (category: NoteCategory | undefined) => LABELS[kindOf(category)];

export function NoteCategories<T extends NoteFilter>({
    value,
    onChange,
    filter = false,
}: {
    value: T;
    onChange: (value: T) => void;
    filter?: boolean;
}) {
    const options = ['global', 'home', 'work'] as T[];
    const style: CSSProperties & { '--segment-index': number; '--segment-count': number } = {
        '--segment-index': options.indexOf(value),
        '--segment-count': options.length,
    };
    return (
        <div
            className="segmented note-categories"
            role="group"
            aria-label={filter ? 'Filter notes' : 'Note category'}
            style={style}
        >
            <span className="segment-fill" aria-hidden="true" />
            {options.map((option) => (
                <button
                    key={option}
                    type="button"
                    className="segment-button"
                    aria-pressed={value === option}
                    onClick={() => onChange(option)}
                >
                    {LABELS[option]}
                </button>
            ))}
        </div>
    );
}
