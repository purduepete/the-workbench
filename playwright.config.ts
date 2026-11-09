import { defineConfig, devices } from '@playwright/test';

const basePort = 4180;
const workers = 3;

export default defineConfig({
    testDir: './tests',
    testMatch: '*.spec.ts',
    workers,
    reporter: 'list',
    use: {
        ...devices['Desktop Chrome'],
        channel: 'msedge',
        baseURL: `http://127.0.0.1:${basePort}`,
        trace: 'retain-on-failure',
    },
    // One production server per worker, each with its own empty in-memory store. Servers start in order,
    // so only the first one builds. tests/fixtures.ts points each worker at its own port.
    webServer: Array.from({ length: workers }, (_, index) => {
        const port = basePort + index;
        return {
            command: `${index === 0 ? 'npm run build && ' : ''}node dist-server/server/main.js`,
            url: `http://127.0.0.1:${port}/api/health`,
            reuseExistingServer: false,
            timeout: 120_000,
            env: {
                STORAGE_BACKEND: 'memory',
                PORT: String(port),
                ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
                SOLUTIONS_SOURCE: 'tests/fixtures/sites.json',
            },
        };
    }),
});
