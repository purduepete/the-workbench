import type { CSSProperties } from 'react';
import type { NoteCategory } from '../shared/contracts';

export type NoteFilter = 'all' | 'home' | 'work' | 'unclassified';
export const categoryLabel = (category: NoteCategory | undefined) =>
    category === 'home' ? 'Home' : category === 'work' ? 'Work' : 'Unclassified';

export function NoteCategories({
    value,
    onChange,
    filter = false,
}: {
    value: NoteFilter;
    onChange: (value: NoteFilter) => void;
    filter?: boolean;
}) {
    const options: NoteFilter[] = filter ? ['all', 'home', 'work', 'unclassified'] : ['home', 'work', 'unclassified'];
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
                    {option === 'all' ? 'All' : option === 'unclassified' ? 'Unclassified' : categoryLabel(option)}
                </button>
            ))}
        </div>
    );
}
