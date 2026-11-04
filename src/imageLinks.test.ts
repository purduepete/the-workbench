import { describe, expect, it } from 'vitest';
import { imageLinkMarkdown, oneDriveImageUrl, splitImageLinks } from './oneDriveLinks';

describe('OneDrive image references', () => {
    it('accepts personal and work/school HTTPS sharing links without dropping access parameters', () => {
        for (const url of [
            'https://1drv.ms/i/s!example?e=abc',
            'https://onedrive.live.com/?cid=123&id=456&authkey=abc',
            'https://photos.onedrive.com/share/example',
            'https://tenant-my.sharepoint.com/:i:/g/personal/example?e=abc',
        ])
            expect(oneDriveImageUrl(` ${url} `)).toBe(url);
    });

    it('rejects unsafe URLs, unrelated hosts, credentials and nonstandard ports', () => {
        for (const url of [
            'not a URL',
            'javascript:alert(1)',
            'data:image/png;base64,abc',
            'file:///C:/image.png',
            'http://1drv.ms/image',
            'https://1drv.ms.evil.example/image',
            'https://evilsharepoint.com/image',
            'https://example.com/image.png',
            'https://user:password@1drv.ms/image',
            'https://1drv.ms:444/image',
        ])
            expect(oneDriveImageUrl(url)).toBeNull();
    });

    it('round-trips labels and URL punctuation while preserving surrounding plain text', () => {
        const url = oneDriveImageUrl('https://1drv.ms/i/example(1)?e=abc');
        expect(url).toBe('https://1drv.ms/i/example%281%29?e=abc');
        const label = 'Photo [front] \\ rear **reference**';
        const markdown = imageLinkMarkdown(label, url!);
        expect(splitImageLinks(`Before\n${markdown}\nAfter`)).toEqual({
            text: 'Before\n\nAfter',
            links: [{ label, url }],
        });
        expect(imageLinkMarkdown(' ', url!)).toBe(`[Image](${url})`);
    });

    it('leaves existing plain text and unrelated Markdown links unchanged', () => {
        for (const body of [
            'Existing **literal** details.',
            '  Existing details.\n',
            '[Website](https://example.com)',
            '[Unsafe](javascript:alert(1))',
            'https://1drv.ms/i/example',
        ])
            expect(splitImageLinks(body)).toEqual({ text: body, links: [] });
    });
});
