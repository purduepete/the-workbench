import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { createApp } from './app.js';
import { createSolutionSource } from './solutions.js';
import { MemoryIdeasStore, PostgresIdeasStore } from './store.js';
import type { IdeasStore } from './store.js';

const backend = process.env.STORAGE_BACKEND;
// "memory" exists for local end-to-end tests only; the deployed manifest pins postgresql.
if (backend !== 'memory' && (backend !== 'postgresql' || !process.env.DATABASE_URL)) {
    throw new Error('DATABASE_URL and STORAGE_BACKEND=postgresql are required.');
}
const port = Number(process.env.PORT ?? '8802');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('PORT must be an integer from 1024 to 65535.');
const origins = (process.env.ALLOWED_ORIGINS ?? `http://127.0.0.1:${port}`).split(',').map((value) => value.trim());
for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol))
        throw new Error('Invalid ALLOWED_ORIGINS.');
}
const html = readFileSync(resolve('dist', 'index.html'), 'utf8');
const hashes = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .filter((match) => match[1].trim())
    .map((match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
const csp = [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Site Dock embeds this app from both of its access paths.
    "frame-ancestors 'self' https://site-dock.jimlertech.com https://jimbrownhome1.tail8ad282.ts.net:8790",
].join('; ');
let pool: pg.Pool | null = null;
let store: IdeasStore;
if (backend === 'postgresql') {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, max: 4 });
    pool.on('error', (error) => console.error('Idle PostgreSQL connection error:', error.message));
    store = new PostgresIdeasStore(pool);
} else {
    console.warn('STORAGE_BACKEND=memory: ideas are lost when the process stops.');
    store = new MemoryIdeasStore();
}
const app = createApp({
    store,
    allowedOrigins: origins,
    // Solution Directory's loopback origin on the host; a file path works for local tests.
    solutions: createSolutionSource(process.env.SOLUTIONS_SOURCE),
    staticDirectory: resolve('dist'),
    contentSecurityPolicy: csp,
});
const server = app.listen(port, '127.0.0.1', () => console.warn(`Idea Notes listening on loopback port ${port}`));
let stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(stopWatcher);
    const deadline = setTimeout(() => {
        console.error('Graceful stop exceeded 15 seconds.');
        process.exit(1);
    }, 15_000);
    deadline.unref();
    server.close(async () => {
        await pool?.end();
        clearTimeout(deadline);
        process.exitCode = 0;
    });
    server.closeIdleConnections();
}
const stopWatcher = setInterval(() => {
    if (process.env.SOLUTIONDEPLOY_STOP_FILE && existsSync(process.env.SOLUTIONDEPLOY_STOP_FILE)) void stop();
}, 1000);
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
