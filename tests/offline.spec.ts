import { expect, test } from './fixtures';
import { localDateKey } from '../src/journal';
import type { ServerGlobalNote, ServerIdea, ServerJournalEntry } from '../shared/contracts';
import type { ServerTask } from '../shared/tasks';

test('first visit prepares a new offline tab, all edit queues survive reload and reconnect once', async ({
    page,
    context,
    request,
}) => {
    test.setTimeout(90_000);
    const suffix = crypto.randomUUID().slice(0, 8);
    const ideaTitle = `Offline idea ${suffix}`;
    const globalTitle = `Offline reference ${suffix}`;
    const taskTitle = `Offline task ${suffix}`;
    const journalBody = `Offline journal ${suffix}`;
    await page.goto('/');
    await expect(page.getByRole('status').first()).toHaveText('Synced');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

    await context.setOffline(true);
    const offline = await context.newPage();
    await offline.goto('/notes');
    await expect(offline.getByRole('heading', { name: 'The Workbench' })).toBeVisible();
    await expect(offline.getByRole('status').first()).toHaveText('Offline');

    await offline.getByRole('button', { name: 'New note', exact: true }).click();
    let dialog = offline.getByRole('dialog');
    await dialog.locator('textarea[name="body"]').fill(journalBody);
    await dialog.getByRole('button', { name: 'Save entry' }).click();
    await offline.getByRole('button', { name: 'Global note', exact: true }).click();
    dialog = offline.getByRole('dialog');
    await dialog.locator('input[name="title"]').fill(globalTitle);
    await dialog.locator('textarea[name="body"]').fill('Saved without Internet');
    await dialog.getByRole('button', { name: 'Save note' }).click();
    await offline.reload();
    await expect(offline.getByText(journalBody, { exact: true })).toBeVisible();
    await offline.getByRole('button', { name: 'Global notes', exact: true }).click();
    await expect(offline.getByRole('heading', { name: globalTitle })).toBeVisible();

    await offline.goto('/');
    await offline.getByRole('button', { name: 'New idea', exact: true }).click();
    dialog = offline.getByRole('dialog');
    await dialog.getByLabel('Idea title').fill(ideaTitle);
    await dialog.getByRole('button', { name: 'Save idea' }).click();
    await offline.reload();
    await expect(offline.getByRole('heading', { name: ideaTitle })).toBeVisible();

    await offline.goto('/tasks');
    await offline.getByRole('button', { name: 'New task', exact: true }).click();
    dialog = offline.getByRole('dialog');
    await dialog.getByLabel('Task title').fill(taskTitle);
    await dialog.getByRole('button', { name: 'Save task' }).click();
    await offline.getByRole('checkbox', { name: `Complete ${taskTitle}`, exact: true }).check();
    await offline.reload();
    await expect(offline.getByRole('checkbox', { name: `Reopen ${taskTitle}`, exact: true })).toBeChecked();
    await expect(offline.getByRole('status').first()).toHaveText(/Offline, \d+ changes? waiting/);

    for (const theme of ['Light', 'Midnight']) {
        await offline.getByRole('button', { name: /^Theme:/ }).click();
        await offline.getByRole('radio', { name: theme, exact: true }).click();
        await offline.keyboard.press('Escape');
        const src = theme === 'Light' ? '/favicon-light.svg' : '/favicon.svg';
        await expect(offline.locator('.brand-mark img')).toHaveAttribute('src', src);
        await expect
            .poll(() => offline.locator('.brand-mark img').evaluate((image: HTMLImageElement) => image.naturalWidth))
            .toBeGreaterThan(0);
    }

    await page.close();
    await context.setOffline(false);
    // The first sync after reconnecting can fail while the network comes back; the app retries every 30 seconds.
    await expect(offline.getByRole('status').first()).toHaveText('Synced', { timeout: 45_000 });
    const { ideas } = (await (await request.get('/api/ideas')).json()) as { ideas: ServerIdea[] };
    const { entries } = (await (await request.get('/api/journal')).json()) as { entries: ServerJournalEntry[] };
    const { notes } = (await (await request.get('/api/global-notes')).json()) as { notes: ServerGlobalNote[] };
    const { tasks } = (await (await request.get('/api/tasks')).json()) as { tasks: ServerTask[] };
    expect(ideas.filter((value) => value.title === ideaTitle)).toHaveLength(1);
    expect(entries.find((value) => value.entryDate === localDateKey())).toMatchObject({ body: journalBody });
    expect(notes.filter((value) => value.title === globalTitle)).toHaveLength(1);
    expect(tasks.filter((value) => value.title === taskTitle)).toHaveLength(1);
    expect(tasks.find((value) => value.title === taskTitle)).toMatchObject({ completed: true });
});

test('a cached shell without downloaded records still allows offline capture', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.evaluate(() => localStorage.clear());
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('button', { name: 'New idea', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Idea title').fill('First local offline idea');
    await dialog.getByRole('button', { name: 'Save idea' }).click();
    await expect(page.getByRole('heading', { name: 'First local offline idea' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'First local offline idea' })).toBeVisible();
    await page.goto('/notes');
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page.getByRole('dialog').locator('textarea[name="body"]').fill('First local offline journal');
    await page.getByRole('dialog').getByRole('button', { name: 'Save entry' }).click();
    await expect(page.getByText('First local offline journal', { exact: true })).toBeVisible();
    await page.goto('/tasks');
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Task title').fill('First local offline task');
    await page.getByRole('dialog').getByRole('button', { name: 'Save task' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'First local offline task' })).toBeVisible();
});

test('stalled API requests time out, preserve a queued edit and recover without an online event', async ({ page }) => {
    test.setTimeout(50_000);
    await page.goto('/');
    await expect(page.getByRole('status').first()).toHaveText('Synced');
    await page.route('**/api/**', () => undefined);
    await page.getByRole('button', { name: 'Refresh ideas', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refresh ideas', exact: true })).toHaveAttribute(
        'data-refreshing',
        'false',
        { timeout: 13_000 }
    );
    await expect(page.getByRole('status').first()).toHaveText('Sync paused');
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await page.getByRole('button', { name: 'New idea', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Idea title').fill('Saved during Internet outage');
    await dialog.getByRole('button', { name: 'Save idea' }).click();
    await expect(page.getByRole('heading', { name: 'Saved during Internet outage' })).toBeVisible();
    await expect(page.getByRole('status').first()).toHaveText('Sync paused, 1 change waiting', { timeout: 13_000 });
    await page.unroute('**/api/**');
    await expect(page.getByRole('status').first()).toHaveText('Synced', { timeout: 35_000 });
    const { ideas } = (await (await page.request.get('/api/ideas')).json()) as { ideas: { title: string }[] };
    expect(ideas.filter((idea) => idea.title === 'Saved during Internet outage')).toHaveLength(1);
});
