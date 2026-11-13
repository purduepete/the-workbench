import type { CSSProperties } from 'react';
import { Briefcase, Globe, House } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NoteCategory } from '../shared/contracts';

/** A note is Home or Work (dated daily notes) or Global (no date). */
export type NoteKind = 'home' | 'work' | 'global';
export type NoteFilter = NoteKind;

const LABELS: Record<NoteKind, string> = { global: 'Global', home: 'Home', work: 'Work' };
export const KIND_ICONS: Record<NoteKind, LucideIcon> = { global: Globe, home: House, work: Briefcase };

/** Daily notes saved before Home and Work were required have no category; they read as Home. */
export const kindOf = (category: NoteCategory | undefined): Exclude<NoteKind, 'global'> =>
    category === 'work' ? 'work' : 'home';

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
            className="segmented note-categories page-pill"
            role="group"
            aria-label={filter ? 'Filter notes' : 'Note category'}
            style={style}
        >
            <span className="segment-fill" aria-hidden="true" />
            {options.map((option) => {
                const Icon: LucideIcon = KIND_ICONS[option as NoteKind];
                return (
                    <button
                        key={option}
                        type="button"
                        className="segment-button"
                        aria-pressed={value === option}
                        onClick={() => onChange(option)}
                    >
                        <Icon size={13} aria-hidden="true" />
                        {LABELS[option]}
                    </button>
                );
            })}
        </div>
    );
}
