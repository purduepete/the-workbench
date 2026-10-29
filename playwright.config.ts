import { defineConfig, devices } from '@playwright/test';

const port = 4180;

export default defineConfig({
    testDir: './tests',
    testMatch: '*.spec.ts',
    workers: 1,
    reporter: 'list',
    use: {
        ...devices['Desktop Chrome'],
        channel: 'msedge',
        baseURL: `http://127.0.0.1:${port}`,
        trace: 'retain-on-failure',
    },
    // Runs the production build and server with the in-memory store, so each run starts empty.
    webServer: {
        command: 'npm run build && node dist-server/server/main.js',
        url: `http://127.0.0.1:${port}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { STORAGE_BACKEND: 'memory', PORT: String(port), ALLOWED_ORIGINS: `http://127.0.0.1:${port}` },
    },
});
