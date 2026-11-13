import { chip, chooseChip, expect, test, workerOrigin, closeDialog } from './fixtures';
import type { APIRequestContext, Page } from './fixtures';
import { taskLimits } from '../shared/tasks';
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
        headers: { Origin: workerOrigin() },
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
async function seedIdea(request: APIRequestContext, title: string) {
    const now = new Date().toISOString();
    const response = await request.post('/api/mutations', {
        headers: { Origin: workerOrigin() },
        data: {
            kind: 'create',
            mutationId: crypto.randomUUID(),
            id: crypto.randomUUID(),
            createdAt: now,
            fields: {
                title,
                body: 'Idea details remain on the idea.',
                tags: [],
                pinned: false,
                archived: false,
                solution: null,
                status: 'n/a',
                updatedAt: now,
            },
        },
    });
    expect(response.ok()).toBe(true);
}
async function add(page: Page, title: string) {
    await page.getByRole('button', { name: 'New task', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
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
            headers: { Origin: workerOrigin() },
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

test('creates a task from an idea title without changing the idea', async ({ page, request }) => {
    const title = 'Turn this idea into work';
    await page.goto('/ideas');
    await page.getByRole('button', { name: 'New idea', exact: true }).click();
    const ideaDialog = page.getByRole('dialog', { name: 'New idea' });
    await ideaDialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    await ideaDialog.getByRole('textbox', { name: 'Details' }).fill('Keep this idea detail.');
    await ideaDialog.getByRole('button', { name: 'Save idea' }).click();
    await expect(page.locator('.local-badge')).toHaveText('Synced');

    const card = page.locator('.idea-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await card.getByRole('button', { name: `Create task from ${title}` }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
    await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
    await expect(dialog.getByRole('textbox', { name: 'Details' })).toHaveValue('Keep this idea detail.');
    await expect(dialog.getByText(formatEntryDate(today()), { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 400);
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(dialog).toBeVisible();
    await closeDialog(dialog);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeFocused();
    const afterCancel = (await (await request.get('/api/tasks')).json()) as { tasks: ServerTask[] };
    expect(afterCancel.tasks.filter((task) => !task.deleted)).toHaveLength(0);

    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Ideas' }).click();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: `Create task from ${title}` }).click();
    await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
    const taskTitle = `${title} follow-up`;
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(taskTitle);
    await chooseChip(dialog, 'Section', 'Work');
    await dialog.getByRole('button', { name: 'Save task' }).click();
    await expect(
        page.getByRole('group', { name: 'Task section' }).getByRole('button', { name: 'Work' })
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: taskTitle, exact: true })).toBeVisible();
    await expect(page.locator('.local-badge')).toHaveText('Synced');
    await page.reload();
    await expect(page.getByRole('heading', { name: taskTitle, exact: true })).toBeVisible();
    const afterSave = (await (await request.get('/api/tasks')).json()) as { tasks: ServerTask[] };
    expect(afterSave.tasks.filter((task) => !task.deleted)).toMatchObject([
        { title: taskTitle, taskDate: today(), category: 'work', body: 'Keep this idea detail.' },
    ]);

    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Ideas' }).click();
    await expect(card.getByText('Keep this idea detail.')).toBeVisible();
});

test('creates an offline task from a maximum-length idea title', async ({ page, context, request }) => {
    const prefix = 'Long idea ';
    const title = prefix + 'x'.repeat(taskLimits.title - prefix.length);
    await seedIdea(request, title);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ideas');
    await expect(page.locator('.local-badge')).toHaveText('Synced');
    await page.waitForFunction(() => localStorage.getItem('the-workbench.tasks-sync') !== null);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    const card = page.locator('.idea-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await context.setOffline(true);
    await card.getByRole('button', { name: `Create task from ${title}` }).click();
    const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
    await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
    await expect(dialog.getByRole('textbox', { name: 'Details' })).toHaveValue('Idea details remain on the idea.');
    await dialog.getByRole('button', { name: 'Save task' }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await context.setOffline(false);
    await expect(page.locator('.local-badge')).toHaveText('Synced');
    const synced = (await (await request.get('/api/tasks')).json()) as { tasks: ServerTask[] };
    expect(synced.tasks.filter((task) => !task.deleted)).toMatchObject([
        { title, taskDate: today(), category: 'home', body: 'Idea details remain on the idea.' },
    ]);
});

for (const device of [
    { name: 'iPhone', platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', mobile: true },
    {
        name: 'desktop-UA iPad',
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
        mobile: false,
    },
]) {
    test.describe(`idea-based task on ${device.name}`, () => {
        test.use({ hasTouch: true, isMobile: device.mobile });

        test('opens without focusing an editable field', async ({ page, request }) => {
            const title = `Task from ${device.name}`;
            await seedIdea(request, title);
            await page.addInitScript(({ platform, userAgent }) => {
                Object.defineProperty(navigator, 'platform', { value: platform });
                Object.defineProperty(navigator, 'userAgent', { value: userAgent });
                Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 });
            }, device);
            await page.setViewportSize(device.mobile ? { width: 390, height: 844 } : { width: 1024, height: 768 });
            await page.goto('/ideas');
            await page.evaluate(() => {
                document.addEventListener('focusin', (event) => {
                    if (
                        event.target instanceof Element &&
                        event.target.matches('dialog input, dialog textarea, dialog [contenteditable]')
                    ) {
                        document.documentElement.dataset.taskInputFocused = 'true';
                    }
                });
            });
            const card = page
                .locator('.idea-card')
                .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
            await card.getByRole('button', { name: `Create task from ${title}` }).click();
            const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
            await expect(dialog).toBeFocused();
            await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
            await expect(page.locator('html')).not.toHaveAttribute('data-task-input-focused', 'true');
            await closeDialog(dialog);
            await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeFocused();
        });
    });
}

test('sync status sits in the header before New on Notes and Tasks, and hides on phones when synced', async ({
    page,
}) => {
    const positions = async (newLabel: string) => {
        const status = page.locator('.top-actions > .local-badge');
        const opener = page.locator('.top-actions').getByRole('button', { name: newLabel, exact: true });
        await expect(status).toHaveText('Synced');
        await expect(page.locator('.intro')).toHaveCount(0);
        // The badge comes right before the New button.
        expect(await opener.evaluate((node) => node.previousElementSibling?.classList.contains('local-badge'))).toBe(
            true
        );
        const badge = await status.boundingBox();
        const button = await opener.boundingBox();
        if (!badge || !button) throw new Error('Sync status or New button is not visible');
        expect(badge.x + badge.width).toBeLessThanOrEqual(button.x);
        expect(Math.abs(badge.y + badge.height / 2 - (button.y + button.height / 2))).toBeLessThanOrEqual(2);
        return badge;
    };

    for (const width of [1280, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/notes');
        const notes = await positions('New note');
        await page.goto('/tasks');
        const tasks = await positions('New task');
        expect(tasks.y).toBeCloseTo(notes.y, 0);
    }
    await page.setViewportSize({ width: 390, height: 900 });
    for (const path of ['/notes', '/tasks']) {
        await page.goto(path);
        const status = page.locator('.local-badge');
        await expect(status).toHaveText('Synced');
        await expect(status).toBeHidden();
    }
});
for (const theme of ['midnight', 'light']) {
    test(`tasks save, complete, move sections and fit phone/desktop in ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('the-workbench.theme-preference', value), theme);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto('/ideas');
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
        expect((await dialog.boundingBox())?.height).toBeCloseTo(828, 0);
        await dialog.getByRole('textbox', { name: 'Details' }).fill('Moved to my work list');
        await chooseChip(dialog, 'Section', 'Work');
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

test('current week defaults, day add buttons and the Date chip pick a day', async ({ page, request }) => {
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
    await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveCount(0);

    // Today's heading is labelled and has its own add button.
    const todayGroup = page.getByRole('region', { name: `Tasks for ${formatEntryDate(today())}`, exact: true });
    await expect(todayGroup.locator('.task-day-heading .card-label')).toHaveText('Today');
    await todayGroup.getByRole('button', { name: `Add a task for ${formatEntryDate(today())}`, exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'New task', exact: true });
    await expect(editor.getByRole('button', { name: `Date: ${formatEntryDate(today())}`, exact: true })).toBeVisible();
    await closeDialog(editor);

    // An older day's add button opens the editor on that day.
    await older.click();
    await expect(page.getByRole('heading', { name: 'Older', exact: true })).toBeVisible();
    const olderGroup = page.getByRole('region', { name: `Tasks for ${formatEntryDate(dayOffset(-14))}`, exact: true });
    await expect(olderGroup.locator('.card-label')).toHaveCount(0);
    await olderGroup
        .getByRole('button', { name: `Add a task for ${formatEntryDate(dayOffset(-14))}`, exact: true })
        .click();
    await expect(
        editor.getByRole('button', { name: `Date: ${formatEntryDate(dayOffset(-14))}`, exact: true })
    ).toBeVisible();
    await closeDialog(editor);

    // A day with no tasks comes from the editor's Date chip.
    await current.click();
    await expect(page.getByRole('heading', { name: 'Current', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'New task', exact: true }).first().click();
    await chip(editor, 'Date').click();
    const calendar = page.getByRole('dialog', { name: 'Choose a date' });
    await calendar.getByRole('button', { name: formatEntryDate(today()), exact: true }).press('ArrowRight');
    // Enter on the focused day chooses it, the same as a click.
    await expect(calendar.getByRole('button', { name: formatEntryDate(dayOffset(1)), exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(calendar).toHaveCount(0);
    await expect(
        editor.getByRole('button', { name: `Date: ${formatEntryDate(dayOffset(1))}`, exact: true })
    ).toBeVisible();
    await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Tomorrow');
    await editor.getByRole('button', { name: 'Save task' }).click();
    await expect(page.getByRole('heading', { name: 'Tomorrow', exact: true })).toBeVisible();

    // A saved task shows its date without letting it change.
    await page.getByRole('button', { name: 'Edit Tomorrow', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit task', exact: true });
    await expect(edit.locator('.chip-static')).toHaveText(`Date: ${formatEntryDate(dayOffset(1))}`);
    await expect(chip(edit, 'Date')).toHaveCount(0);
    await closeDialog(edit);
});

test('calendar Today selects the current day without closing the editor', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByRole('button', { name: 'New task', exact: true }).first().click();
    const editor = page.getByRole('dialog', { name: 'New task', exact: true });
    await chip(editor, 'Date').click();
    const calendar = page.getByRole('dialog', { name: 'Choose a date' });
    const yesterday = formatEntryDate(dayOffset(-1));
    const currentDay = formatEntryDate(today());
    await calendar.getByRole('button', { name: currentDay, exact: true }).press('ArrowLeft');
    await expect(calendar.getByRole('button', { name: yesterday, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await calendar.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(calendar).toBeVisible();
    await expect(calendar.getByRole('button', { name: currentDay, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await closeDialog(calendar);
    await expect(calendar).toHaveCount(0);
    await expect(editor).toBeVisible();
    await expect(chip(editor, 'Date')).toHaveAccessibleName(`Date: ${currentDay}`);
    await closeDialog(editor);
    await expect(page.getByRole('dialog')).toHaveCount(0);
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
    // Let the drop animation and its sync finish before starting a keyboard sort on the same handle.
    await expect(page.locator('.local-badge')).toHaveText('Synced');
    const handle = page.getByRole('button', { name: 'Move First', exact: true });
    const firstRow = page.getByRole('listitem', { name: 'First', exact: true });
    // Each key waits for the visible drag state, so no keystroke lands before the library is ready.
    await handle.focus();
    await handle.press('Space');
    await expect(handle).toHaveAttribute('aria-pressed', 'true');
    await handle.press('ArrowUp');
    await expect(firstRow).toHaveAttribute('style', /translate3d\(0px, -/);
    await handle.press('Space');
    await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
    await expect(taskOrder(page)).toHaveText(['Second', 'First', 'Third']);
    await handle.press('Space');
    await expect(handle).toHaveAttribute('aria-pressed', 'true');
    await handle.press('ArrowDown');
    await expect(firstRow).toHaveAttribute('style', /translate3d\(0px, \d/);
    await handle.press('Escape');
    await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
    await expect(taskOrder(page)).toHaveText(['Second', 'First', 'Third']);
    await page.getByRole('checkbox', { name: 'Complete First', exact: true }).check();
    await expect(taskOrder(page)).toHaveText(['Second', 'First', 'Third']);
    await expect(page.locator('.local-badge')).toHaveText('Synced');
    await page.reload();
    await expect(taskOrder(page)).toHaveText(['Second', 'First', 'Third']);
    await expect(page.getByRole('checkbox', { name: 'Reopen First', exact: true })).toBeChecked();
    await page.getByRole('searchbox', { name: 'Search tasks' }).fill('First');
    await expect(page.getByRole('button', { name: 'Move First', exact: true })).toBeDisabled();
});

test('task drafts require Cancel or Save and offline capture survives reload', async ({ page, context }) => {
    await page.goto('/ideas');
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Tasks' }).click();
    await page.getByRole('button', { name: 'New task', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    expect((await dialog.boundingBox())?.width).toBeCloseTo(1100, 0);
    const body = dialog.getByRole('textbox', { name: 'Details' });
    await body.fill('Body-only protected draft');
    await body.press('Escape');
    await page.mouse.click(5, 400);
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect(page.getByRole('button', { name: 'New task', exact: true }).first()).toBeVisible();
    await context.setOffline(true);
    await add(page, 'Offline task');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Offline task', exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect(page.locator('.local-badge')).toHaveText('Synced');
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
