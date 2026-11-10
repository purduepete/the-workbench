import { useEffect } from 'react';
import type { RefObject } from 'react';

const highlightName = 'search-match';

// Marks every case-insensitive match of the search text inside result items, without changing the rendered DOM.
export function useSearchHighlight(root: RefObject<HTMLElement | null>, query: string, itemSelector: string) {
    useEffect(() => {
        const container = root.current;
        const needle = query.trim().toLocaleLowerCase();
        if (!container || !needle || typeof Highlight === 'undefined' || !('highlights' in CSS)) return;
        const paint = () => {
            const ranges: Range[] = [];
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
                acceptNode: (node) =>
                    node.parentElement?.closest(itemSelector) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
            });
            while (walker.nextNode()) {
                const node = walker.currentNode as Text;
                const text = node.data.toLocaleLowerCase();
                if (text.length !== node.data.length) continue;
                for (
                    let index = text.indexOf(needle);
                    index !== -1;
                    index = text.indexOf(needle, index + needle.length)
                ) {
                    const range = new Range();
                    range.setStart(node, index);
                    range.setEnd(node, index + needle.length);
                    ranges.push(range);
                }
            }
            CSS.highlights.set(highlightName, new Highlight(...ranges));
        };
        paint();
        const observer = new MutationObserver(paint);
        observer.observe(container, { subtree: true, childList: true, characterData: true });
        return () => {
            observer.disconnect();
            CSS.highlights.delete(highlightName);
        };
    }, [root, query, itemSelector]);
}
