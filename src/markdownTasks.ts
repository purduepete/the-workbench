// A task item's bullet, after any blockquote markers and indentation, followed by its [ ] or [x] box.
const taskMarker = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[( |x|X)\]/;

/**
 * Sets the checkbox of the Markdown task item that starts on the line containing `offset`.
 * Returns the new body, or null when that line is not a task item (the body changed underneath).
 */
export function setMarkdownTask(body: string, offset: number, checked: boolean): string | null {
    if (offset < 0 || offset > body.length) return null;
    const lineStart = body.lastIndexOf('\n', offset - 1) + 1;
    const match = taskMarker.exec(body.slice(lineStart));
    if (!match) return null;
    const box = lineStart + match[1].length + 1;
    return body.slice(0, box) + (checked ? 'x' : ' ') + body.slice(box + 1);
}
