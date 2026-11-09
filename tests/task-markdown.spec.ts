import { expect, test } from './fixtures';

const body = [
    '# A formatted task',
    '',
    '**Important detail** and *a thought*.',
    '',
    '- First item',
    '- Second item',
    '',
    '3. Third step',
    '4. Fourth step',
    '',
    ...Array.from({ length: 10 }, (_, index) => `Paragraph ${index + 1} with extra context.\n`),
    '[Read the final reference](https://example.com/reference)',
    '',
    '<script>alert("unsafe")</script>',
    '[Unsafe link](javascript:alert(1))',
].join('\n');

for (const theme of ['midnight', 'light']) {
    test(`task Markdown saves, previews and expands on hover and focus in ${theme}`, async ({ page }) => {
        await page.addInitScript((theme) => localStorage.setItem('the-workbench.theme-preference', theme), theme);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto('/tasks');
        await page.getByRole('button', { name: 'New task', exact: true }).click();
        const dialog = page.getByRole('dialog');
        const title = `Markdown task ${theme}`;
        await dialog.getByLabel('Task title', { exact: true }).fill(title);
        await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill(body);
        await expect(dialog.getByRole('button', { name: 'Markdown syntax help', exact: true })).toBeVisible();
        await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
        await expect(dialog.locator('.markdown-editor-preview strong')).toHaveText('Important detail');
        await expect(dialog.locator('.markdown-editor-preview ul li')).toHaveCount(2);
        await expect(dialog.locator('.markdown-editor-preview ol')).toHaveAttribute('start', '3');
        await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
        const row = page.getByRole('listitem', { name: title, exact: true });
        const details = row.locator('.task-details');
        await page.mouse.move(0, 0);
        await expect(row.locator('strong')).toHaveText('Important detail');
        const isExpanded = () => details.evaluate((node) => node.scrollHeight <= node.clientHeight + 1);
        await expect.poll(isExpanded).toBe(false);
        const more = row.locator('.details-more');
        await expect(more).toBeVisible();
        await expect(more).toHaveCSS('opacity', '1');
        for (const control of [
            row.getByRole('checkbox', { name: `Complete ${title}`, exact: true }),
            row.getByRole('button', { name: `Move ${title}`, exact: true }),
            row.getByRole('button', { name: `Edit ${title}`, exact: true }),
        ]) {
            await control.hover();
            await page.waitForTimeout(1200);
            expect(await isExpanded()).toBe(false);
        }
        await row.locator('.task-text').hover();
        await expect.poll(isExpanded).toBe(true);
        await expect(more).toBeHidden();
        expect(await details.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
        await expect(row.getByRole('link', { name: 'Read the final reference' })).toHaveAttribute(
            'href',
            'https://example.com/reference'
        );
        await expect(row.locator('script, a[href^="javascript:"]')).toHaveCount(0);
        // Hover expansion stays after the pointer leaves; Show less collapses it.
        await page.mouse.move(0, 0);
        await page.waitForTimeout(500);
        expect(await isExpanded()).toBe(true);
        await row.getByRole('button', { name: 'Show less', exact: true }).click();
        await page.mouse.move(0, 0);
        await expect.poll(isExpanded).toBe(false);
        // Keyboard focus expands the details; mouse focus does not.
        await page.keyboard.press('Shift');
        await row.focus();
        await expect.poll(isExpanded).toBe(true);
        await row.evaluate((node) => node.blur());
        await expect(row.locator('.task-details-toggle')).toBeHidden();
        await page.mouse.move(0, 0);
        await expect.poll(isExpanded).toBe(false);
        await row.locator('.task-text').hover();
        await expect.poll(isExpanded).toBe(true);
        const rowBox = await row.boundingBox();
        const editBox = await row.getByRole('button', { name: `Edit ${title}`, exact: true }).boundingBox();
        if (!rowBox || !editBox) throw new Error('Task card or edit control is missing.');
        expect(rowBox.y + rowBox.height - editBox.y - editBox.height).toBeCloseTo(11, 0);
        await row.getByRole('button', { name: `Edit ${title}`, exact: true }).hover();
        await page.waitForTimeout(300);
        expect(await isExpanded()).toBe(true);
        await row.getByRole('button', { name: 'Show less', exact: true }).click();
        await page.mouse.move(0, 0);
        await expect.poll(isExpanded).toBe(false);
        await page.mouse.move(0, 0);
        await row.getByRole('checkbox', { name: `Complete ${title}`, exact: true }).check();
        await expect(row).toHaveAttribute('data-completed', 'true');
        await expect(page.getByRole('status').first()).toHaveText('Synced');
        await page.reload();
        await row.getByRole('button', { name: `Edit ${title}`, exact: true }).click();
        await expect(dialog.getByRole('textbox', { name: 'Details', exact: true })).toHaveValue(body);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    });
}

test.describe('touch task details', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

    test('tap expands and collapses the full formatted task', async ({ page }) => {
        await page.goto('/tasks');
        await page.getByRole('button', { name: 'New task', exact: true }).tap();
        const dialog = page.getByRole('dialog');
        const title = 'Touch Markdown task';
        await dialog.getByLabel('Task title', { exact: true }).fill(title);
        await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill(body);
        await dialog.getByRole('button', { name: 'Save task', exact: true }).tap();
        const row = page.getByRole('listitem', { name: title, exact: true });
        const details = row.locator('.task-details');
        const isExpanded = () => details.evaluate((node) => node.scrollHeight <= node.clientHeight + 1);
        await expect.poll(isExpanded).toBe(false);
        await row.getByRole('button', { name: 'Show details', exact: true }).tap();
        await expect.poll(isExpanded).toBe(true);
        await expect(row.locator('strong')).toHaveText('Important detail');
        expect(await details.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
        await row.getByRole('button', { name: 'Show less', exact: true }).tap();
        await expect.poll(isExpanded).toBe(false);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });

    test('hides Show details when the whole task already fits', async ({ page }) => {
        await page.goto('/tasks');
        await page.getByRole('button', { name: 'New task', exact: true }).tap();
        const dialog = page.getByRole('dialog');
        const title = 'Short touch task';
        await dialog.getByLabel('Task title', { exact: true }).fill(title);
        await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill('One short line.');
        await dialog.getByRole('button', { name: 'Save task', exact: true }).tap();
        const row = page.getByRole('listitem', { name: title, exact: true });
        await expect(row.locator('.task-details')).toHaveAttribute('data-truncated', 'false');
        await expect(row.getByRole('button', { name: 'Show details', exact: true })).toBeHidden();
    });
});
