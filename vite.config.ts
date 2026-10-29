import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    // Local development runs the API server separately on its default port.
    server: { proxy: { '/api': 'http://127.0.0.1:8802' } },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    },
});
