export const INDENT_SIZE = 4;

export function indentMarkdown(value: string, start: number, end: number, outdent: boolean) {
    if (start === end && !outdent) {
        return {
            value: value.slice(0, start) + ' '.repeat(INDENT_SIZE) + value.slice(end),
            start: start + INDENT_SIZE,
            end: end + INDENT_SIZE,
        };
    }

    const first = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
    const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
    const edits: { at: number; remove: number; insert: string }[] = [];
    for (let at = first; at <= last;) {
        const remove = outdent ? (/^(?:\t| {1,4})/.exec(value.slice(at))?.[0].length ?? 0) : 0;
        edits.push({ at, remove, insert: outdent ? '' : ' '.repeat(INDENT_SIZE) });
        const next = value.indexOf('\n', at);
        if (next === -1 || next >= last) break;
        at = next + 1;
    }
    const move = (position: number) =>
        position +
        edits.reduce(
            (delta, edit) =>
                delta + (edit.at <= position ? edit.insert.length - Math.min(edit.remove, position - edit.at) : 0),
            0
        );
    let updated = value;
    for (const edit of edits.reverse()) {
        updated = updated.slice(0, edit.at) + edit.insert + updated.slice(edit.at + edit.remove);
    }
    return { value: updated, start: move(start), end: move(end) };
}

export function markdownIndentDepth(value: string, position: number) {
    const lineStart = position === 0 ? 0 : value.lastIndexOf('\n', position - 1) + 1;
    const whitespace = /^[ \t]*/.exec(value.slice(lineStart))?.[0] ?? '';
    let columns = 0;
    for (const char of whitespace) {
        columns += char === '\t' ? INDENT_SIZE - (columns % INDENT_SIZE) : 1;
    }
    return Math.floor(columns / INDENT_SIZE);
}
