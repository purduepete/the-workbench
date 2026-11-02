import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import type { ServerTask } from '../shared/tasks';
import { formatEntryDate, localDateKey, weekStart } from '../src/journal';

const today = () => localDateKey();
const dayOffset = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return localDateKey(date);
};
async function seed(request: APIRequestContext, title: string, taskDate = today(), category = 'home') {
    const response = await request.post('/api/tasks/mutations', {
        headers: { Origin: 'http://127.0.0.1:4180' },
        data: {
            kind: 'save',
            mutationId: crypto.randomUUID(),
            id: crypto.randomUUID(),
            taskDate,
            category,
            title,
            body: '',
            updatedAt: new Date().toISOString(),
        },
    });
    expect(response.ok()).toBe(true);
}
async function add(page: Page, title: string) {
    await page.getByRole('button', { name: 'New task', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
    await dialog.getByRole('textbox', { name: 'Task title' }).fill(title);
    await dialog.getByRole('button', { name: 'Save task' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}
const taskOrder = (page: Page) =>
    page
        .locator('.task-day')
        .filter({
            has: page.locator(`time[datetime="${today()}"]`),
        })
        .locator('.task-title');

test.beforeEach(async ({ request }) => {
    const response = await request.get('/api/tasks');
    const result = (await response.json()) as { tasks: ServerTask[] };
    for (const task of result.tasks.filter((value) => !value.deleted)) {
        const deleted = await request.post('/api/tasks/mutations', {
            headers: { Origin: 'http://127.0.0.1:4180' },
            data: {
                kind: 'delete',
                mutationId: crypto.randomUUID(),
                id: task.id,
                taskDate: task.taskDate,
            },
        });
        expect(deleted.ok()).toBe(true);
    }
});

for (const theme of ['midnight', 'light']) {
    test(`tasks save, complete, move sections and fit phone/desktop in ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('idea-notes.theme-preference', value), theme);
        await page.goto('/');
        await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Tasks' }).click();
        await expect(page).toHaveURL(/\/tasks$/);
        await add(page, `Home ${theme}`);
        const checkbox = page.getByRole('checkbox', { name: `Complete Home ${theme}` });
        await checkbox.check();
        await expect(page.getByRole('checkbox', { name: `Reopen Home ${theme}` })).toBeChecked();
        await expect(page.locator('.task-title')).toHaveCSS('text-decoration-line', 'line-through');
        await page.getByRole('checkbox', { name: `Reopen Home ${theme}` }).uncheck();
        await expect(checkbox).not.toBeChecked();
        await page.getByRole('button', { name: `Edit Home ${theme}` }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit task', exact: true });
        await dialog.getByRole('textbox', { name: 'Details' }).fill('Moved to my work list');
        await dialog.getByRole('group', { name: 'Task category' }).getByRole('button', { name: 'Work' }).click();
        await dialog.getByRole('button', { name: 'Save task' }).click();
        const sections = page.getByRole('group', { name: 'Task section' });
        await expect(sections.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByText('Moved to my work list')).toBeVisible();
        await page.reload();
        await expect(sections.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('heading', { name: `Home ${theme}` })).toBeVisible();
        await sections.getByRole('button', { name: 'Home' }).click();
        await expect(page.getByRole('heading', { name: `Home ${theme}` })).toHaveCount(0);
        await sections.getByRole('button', { name: 'Work' }).click();
        for (const width of [390, 768, 1280, 1440, 1920]) {
            await page.setViewportSize({ width, height: 900 });
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
            ).toBeLessThanOrEqual(0);
            if (width >= 1024) {
                const header = await page.locator('.topbar-inner').boundingBox();
                const main = await page.locator('main.page-width').boundingBox();
                expect(header?.x).toBeCloseTo(main?.x ?? -1, 0);
                expect(header?.width).toBeCloseTo(main?.width ?? -1, 0);
            }
        }
        await page.getByRole('button', { name: `Edit Home ${theme}` }).click();
        await dialog.getByRole('button', { name: 'Delete task' }).click();
        await dialog.getByRole('button', { name: 'Confirm delete' }).click();
        await expect(page.getByRole('heading', { name: `Home ${theme}` })).toHaveCount(0);
    });
}

test('current week defaults, calendar jumps and empty-day editor', async ({ page, request }) => {
    await seed(request, 'Current');
    await seed(request, 'Older', dayOffset(-14));
    await seed(request, 'Future', dayOffset(14));
    await seed(request, 'Work tomorrow', dayOffset(1), 'work');
    await page.goto('/tasks');
    const current = page.getByRole('button', { name: `Week of ${formatEntryDate(weekStart(today()))}`, exact: true });
    const older = page.getByRole('button', {
        name: `Week of ${formatEntryDate(weekStart(dayOffset(-14)))}`,
        exact: true,
    });
    const future = page.getByRole('button', {
        name: `Week of ${formatEntryDate(weekStart(dayOffset(14)))}`,
        exact: true,
    });
    await expect(current).toHaveAttribute('aria-expanded', 'true');
    await expect(older).toHaveAttribute('aria-expanded', 'false');
    await expect(future).toHaveAttribute('aria-expanded', 'false');
    await current.click();
    await expect(page.getByRole('heading', { name: 'Current', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const calendar = page.getByRole('dialog', { name: 'Choose a day' });
    await expect(calendar.locator('.dialog-close')).toHaveCount(0);
    await expect(calendar.getByRole('button', { name: formatEntryDate(today()), exact: true })).toHaveAttribute(
        'data-has-entry',
        'true'
    );
    await calendar.getByRole('button', { name: formatEntryDate(today()), exact: true }).press('ArrowLeft');
    for (let step = 1; step < 14; step++) await page.keyboard.press('ArrowLeft');
    await calendar.getByRole('button', { name: formatEntryDate(dayOffset(-14)), exact: true }).click();
    await calendar.getByRole('button', { name: `Open ${formatEntryDate(dayOffset(-14))}` }).click();
    await expect(older).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('heading', { name: 'Older', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await calendar.getByRole('button', { name: formatEntryDate(today()), exact: true }).press('ArrowRight');
    await expect(calendar.getByRole('button', { name: formatEntryDate(dayOffset(1)), exact: true })).toHaveAttribute(
        'data-has-entry',
        'false'
    );
    await calendar.getByRole('button', { name: formatEntryDate(dayOffset(1)), exact: true }).click();
    await calendar.getByRole('button', { name: `Open ${formatEntryDate(dayOffset(1))}` }).click();
    const editor = page.getByRole('dialog', { name: 'New task', exact: true });
    await expect(editor).toBeVisible();
    await expect(editor.getByText(formatEntryDate(dayOffset(1)), { exact: true })).toBeVisible();
    await editor.getByRole('textbox', { name: 'Task title' }).fill('Tomorrow');
    await editor.getByRole('button', { name: 'Save task' }).click();
    await expect(page.getByRole('heading', { name: 'Tomorrow', exact: true })).toBeVisible();
});

test('pointer and keyboard reorder persist and completion preserves order', async ({ page, request }) => {
    for (const title of ['First', 'Second', 'Third']) await seed(request, title);
    await page.goto('/tasks');
    await expect(taskOrder(page)).toHaveText(['First', 'Second', 'Third']);
    const start = await page.getByRole('button', { name: 'Move First', exact: true }).boundingBox();
    const target = await page.getByRole('button', { name: 'Move Third', exact: true }).boundingBox();
    if (!start || !target) throw new Error('Drag handles not visible');
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(taskOrder(page)).toHaveText(['Second', 'Third', 'First']);
    const handle = page.getByRole('button', { name: 'Move First', exact: true });
    await handle.focus();
    await handle.press('Space');
    await handle.press('ArrowUp');
    await handle.press('Space');
    await expect(taskOrder(page)).toHaveText(['Second', 'First', 'Third']);
    await handle.press('Space');
    await handle.press('ArrowDown');
    await handle.press('Escape');
    await expect(taskOrder(page)).toHaveText(['Second', 'First', 'Third']);
    await page.getByRole('checkbox', { name: 'Complete First', exact: true }).check();
    await expect(taskOrder(page)).toHaveText(['Second', 'First', 'Third']);
    await expect(page.getByRole('status').first()).toHaveText('Synced');
    await page.reload();
    await expect(taskOrder(page)).toHaveText(['Second', 'First', 'Third']);
    await expect(page.getByRole('checkbox', { name: 'Reopen First', exact: true })).toBeChecked();
    await page.getByRole('searchbox', { name: 'Search tasks' }).fill('First');
    await expect(page.getByRole('button', { name: 'Move First', exact: true })).toBeDisabled();
});

test('task drafts require Cancel or Save and offline capture survives reload', async ({ page, context }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Tasks' }).click();
    await page.getByRole('button', { name: 'New task', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
    await expect(dialog.locator('.dialog-close')).toHaveCount(0);
    expect((await dialog.boundingBox())?.width).toBeCloseTo(960, 0);
    const body = dialog.getByRole('textbox', { name: 'Details' });
    await body.fill('Body-only protected draft');
    await body.press('Escape');
    await page.mouse.click(5, 400);
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect(page.getByRole('button', { name: 'New task', exact: true }).first()).toBeVisible();
    await context.setOffline(true);
    await add(page, 'Offline task');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Offline task', exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole('status').first()).toHaveText('Synced');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Offline task', exact: true })).toBeVisible();
});

test.describe('touch task ordering', () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
    test('drag handle responds to a touch swipe', async ({ page, request }) => {
        await seed(request, 'Touch first');
        await seed(request, 'Touch second');
        await page.goto('/tasks');
        const start = await page.getByRole('button', { name: 'Move Touch first', exact: true }).boundingBox();
        const end = await page.getByRole('button', { name: 'Move Touch second', exact: true }).boundingBox();
        if (!start || !end) throw new Error('Touch handles not visible');
        const cdp = await page.context().newCDPSession(page);
        const x = start.x + start.width / 2,
            y = start.y + start.height / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 8; step++) {
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ x, y: y + ((end.y + end.height / 2 - y) * step) / 8 }],
            });
            await page.waitForTimeout(40);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
        await expect(taskOrder(page)).toHaveText(['Touch second', 'Touch first']);
    });
});
