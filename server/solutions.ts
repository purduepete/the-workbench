import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { solutionIdPattern } from '../shared/contracts.js';
import type { Solution } from '../shared/contracts.js';

const sitesSchema = z.object({
    sites: z.array(z.object({ id: z.string().regex(solutionIdPattern), name: z.string().trim().min(1).max(80) })),
});

export type SolutionSource = () => Promise<Solution[]>;

/**
 * Reads Solution Directory's sites.json from an http(s) URL or a file path.
 * A failed read returns the last good list; with no earlier success it throws.
 */
export function createSolutionSource(location: string | undefined, timeoutMs = 3000): SolutionSource {
    let lastGood: Solution[] | null = null;
    return async () => {
        if (!location) return [];
        try {
            const raw = /^https?:\/\//.test(location)
                ? await fetch(location, { signal: AbortSignal.timeout(timeoutMs) }).then((response) => {
                      if (!response.ok) throw new Error(`Solution list returned ${response.status}.`);
                      return response.json() as Promise<unknown>;
                  })
                : (JSON.parse(await readFile(location, 'utf8')) as unknown);
            lastGood = sitesSchema
                .parse(raw)
                .sites.map(({ id, name }) => ({ id, name }))
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            if (!lastGood) throw error;
            console.error('Solution list refresh failed:', error instanceof Error ? error.message : 'Unknown error');
        }
        return lastGood;
    };
}
