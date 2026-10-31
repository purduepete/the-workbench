import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFirstLoad } from './useFirstLoad';

vi.mock('react', () => ({ useLayoutEffect: (effect: () => void) => effect() }));
const dataset: { firstLoad: string } = { firstLoad: 'pending' };
beforeEach(() => {
    vi.useFakeTimers();
    dataset.firstLoad = 'pending';
    vi.stubGlobal('document', { documentElement: { dataset }, querySelector: () => null });
    vi.stubGlobal('window', { setTimeout });
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
it('holds no-cache content, reveals valid cache immediately and never repeats on refresh', () => {
    useFirstLoad(false, false);
    expect(dataset.firstLoad).toBe('pending');
    useFirstLoad(true, false);
    expect(dataset.firstLoad).toBe('ready');
    vi.advanceTimersByTime(600);
    expect(dataset.firstLoad).toBe('complete');
    useFirstLoad(false, false);
    expect(dataset.firstLoad).toBe('complete');
});
it('reveals failed sync immediately and keeps the shell visible during retry', () => {
    useFirstLoad(false, true);
    expect(dataset.firstLoad).toBe('error');
    useFirstLoad(false, false);
    expect(dataset.firstLoad).toBe('error');
});
