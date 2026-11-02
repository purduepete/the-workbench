export function syncFetch(input: string, init?: RequestInit): Promise<Response> {
    if (!navigator.onLine) return Promise.reject(new Error('Offline. Changes stay on this device.'));
    return fetch(input, { ...init, signal: AbortSignal.timeout(10_000) });
}
