import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncFetch } from './syncFetch';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('sync requests', () => {
    it('does not send a mutation when the browser is offline', async () => {
        vi.stubGlobal('navigator', { onLine: false });
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        await expect(syncFetch('/api/mutations', { method: 'POST' })).rejects.toThrow('Offline');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('bounds a connected request while preserving its method and payload', async () => {
        vi.stubGlobal('navigator', { onLine: true });
        const signal = new AbortController().signal;
        const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
        const response = new Response('{}');
        const fetch = vi.fn().mockResolvedValue(response);
        vi.stubGlobal('fetch', fetch);
        await expect(syncFetch('/api/mutations', { method: 'POST', body: '{}' })).resolves.toBe(response);
        expect(timeout).toHaveBeenCalledWith(10_000);
        expect(fetch).toHaveBeenCalledWith('/api/mutations', { method: 'POST', body: '{}', signal });
    });
});
