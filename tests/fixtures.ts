import { test as base } from '@playwright/test';
import type { Locator } from '@playwright/test';

export * from '@playwright/test';

// Each Playwright worker gets its own in-memory server (see playwright.config.ts), so tests never share data.
export const basePort = 4180;
export const defaultOrigin = `http://127.0.0.1:${basePort}`;
export const workerOrigin = (parallelIndex = base.info().parallelIndex) =>
    `http://127.0.0.1:${basePort + parallelIndex}`;

export const test = base.extend({
    baseURL: async ({ baseURL }, provide, testInfo) => {
        await provide(baseURL === defaultOrigin ? workerOrigin(testInfo.parallelIndex) : baseURL);
    },
});

/** Presses the dialog's X and, when it asks to discard unsaved text, confirms. */
export async function closeDialog(dialog: Locator) {
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const discard = dialog.getByRole('button', { name: 'Discard changes', exact: true });
    if (await discard.isVisible()) await discard.click();
}
