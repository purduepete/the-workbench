/** Commentary sits beside a note section. Each section has one commentary row, found by a stable id. */

/** A heading's text as it reads on screen, folded so small edits in spacing or case keep their commentary. */
export function sectionKey(heading: string): string {
    return heading
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase();
}

/** The keys of the note's `## ` sections in order, skipping fenced code; empty when the note has none. */
export function sectionKeys(body: string): string[] {
    const keys: string[] = [];
    let fence: string | null = null;
    for (const line of body.split('\n')) {
        const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker) {
            if (!fence) fence = marker[0];
            else if (marker[0] === fence) fence = null;
            continue;
        }
        if (!fence && /^## \S/.test(line)) keys.push(sectionKey(line.slice(3)));
    }
    return keys;
}

/** The key for a note with no sections: its commentary belongs to the whole note. */
export const WHOLE_NOTE = '';

function hash32(text: string, seed: number): number {
    let h = seed ^ text.length;
    for (let index = 0; index < text.length; index += 1) {
        h = Math.imul(h ^ text.charCodeAt(index), 0x5bd1e995);
        h ^= h >>> 15;
    }
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
}

/** A version 8 UUID derived from the note and section, so every device finds the same commentary row. */
export function commentaryId(noteId: string, key: string): string {
    const text = `${noteId}\u0000${key}`;
    const hex = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f]
        .map((seed) => hash32(text, seed).toString(16).padStart(8, '0'))
        .join('');
    const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
