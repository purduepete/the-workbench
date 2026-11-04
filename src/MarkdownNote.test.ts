import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root } from 'mdast';
import { remarkNoteSections } from './MarkdownNote';

describe('remarkNoteSections', () => {
    it('groups level-two sections and keeps link definitions at the root', async () => {
        const source = [
            'Intro text',
            '',
            '## First',
            'A [reference][target].',
            '',
            '## Second',
            '```md',
            '## Not a section',
            '```',
            '',
            '[target]: https://example.com',
        ].join('\n');
        const processor = unified().use(remarkParse).use(remarkNoteSections);
        const tree = (await processor.run(processor.parse(source))) as Root;
        const sections = tree.children.filter((node) => node.type === 'noteSection');

        expect(sections).toHaveLength(2);
        expect(tree.children.some((node) => node.type === 'paragraph')).toBe(true);
        expect(tree.children.some((node) => node.type === 'definition')).toBe(true);
        expect(sections[0]).toMatchObject({ type: 'noteSection', data: { hName: 'section' } });
        expect(sections[0].children[0]).toMatchObject({ type: 'heading', depth: 2 });
        expect(sections[1].children[0]).toMatchObject({ type: 'heading', depth: 2 });
        expect(sections[1].children[1]).toMatchObject({ type: 'code', value: '## Not a section' });
    });

    it('turns raw HTML into text nodes', async () => {
        const processor = unified().use(remarkParse).use(remarkNoteSections);
        const tree = (await processor.run(processor.parse('Before <script>alert(1)</script> after'))) as Root;

        expect(JSON.stringify(tree)).not.toContain('"type":"html"');
        expect(JSON.stringify(tree)).toContain('<script>');
        expect(JSON.stringify(tree)).toContain('alert(1)');
        expect(JSON.stringify(tree)).toContain('</script>');
    });
});
