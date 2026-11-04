import { describe, expect, it, vi } from 'vitest';
import { safeThumbnailUrl, thumbnailEndpoint } from './OneDriveThumbnail';

const session = {
    config: {
        clientId: 'c0a99a60-f88b-4c7a-b373-af219b450399',
        tenantId: 'consumers',
        baseUrl: 'https://onedrive.live.com/picker',
    },
    signIn: vi.fn(),
    token: vi.fn(),
};

describe('OneDrive thumbnails', () => {
    it('uses the personal item id without sending link parameters as credentials', () => {
        expect(thumbnailEndpoint('https://onedrive.live.com/?id=abc!123&authkey=example', session)).toBe(
            'https://api.onedrive.com/v1.0/drive/items/abc!123/thumbnails'
        );
    });
    it('encodes sharing URLs and rejects unsupported links', () => {
        const href = 'https://1drv.ms/i/example?e=abc';
        const endpoint = thumbnailEndpoint(href, session);
        const encoded = endpoint.split('/shares/u!')[1].split('/')[0];
        expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe(href);
        expect(() => thumbnailEndpoint('https://unrelated.example/image', session)).toThrow();
    });
    it('accepts only Microsoft thumbnail hosts over HTTPS', () => {
        expect(safeThumbnailUrl('https://southcentralus1-medias.svc.ms/transform/thumbnail')).toBe(
            'https://southcentralus1-medias.svc.ms/transform/thumbnail'
        );
        expect(safeThumbnailUrl('https://example.files.1drv.com/thumbnail?auth=temporary')).toBe(
            'https://example.files.1drv.com/thumbnail?auth=temporary'
        );
        for (const href of [
            'https://example.files.1drv.com.evil.example/image',
            'https://southcentralus1-medias.svc.ms.evil.example/image',
            'https://other.svc.ms/image',
            'https://unrelated.example/image',
            'http://example.files.1drv.com/image',
            'https://user:password@example.files.1drv.com/image',
            'https://example.files.1drv.com:444/image',
        ])
            expect(() => safeThumbnailUrl(href)).toThrow();
    });
});
