import { expect, test } from './fixtures';

const body = [
    '# A formatted idea',
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
].join('\n');

for (const theme of ['midnight', 'light']) {
    test(`idea Markdown saves, previews and expands fully on hover and focus in ${theme}`, async ({ page }) => {
        await page.addInitScript((theme) => localStorage.setItem('the-workbench.theme-preference', theme), theme);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto('/');
        await page.getByRole('button', { name: 'New idea', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Idea title', { exact: true }).fill(`Markdown idea ${theme}`);
        await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill(body);
        await expect(dialog.getByRole('button', { name: 'Markdown syntax help', exact: true })).toBeVisible();
        await dialog
            .getByRole('group', { name: 'Details mode', exact: true })
            .getByRole('button', { name: 'Preview', exact: true })
            .click();
        await expect(dialog.locator('.markdown-editor-preview strong')).toHaveText('Important detail');
        await expect(dialog.locator('.markdown-editor-preview ul li')).toHaveCount(2);
        await expect(dialog.locator('.markdown-editor-preview ol')).toHaveAttribute('start', '3');
        await dialog.getByRole('button', { name: 'Save idea', exact: true }).click();
        const card = page.getByRole('article', { name: `Markdown idea ${theme}`, exact: true });
        const details = card.locator('.idea-details');
        await page.mouse.move(0, 0);
        await expect(card.locator('strong')).toHaveText('Important detail');
        const isExpanded = () => details.evaluate((node) => node.scrollHeight <= node.clientHeight + 1);
        await expect.poll(isExpanded).toBe(false);
        const more = card.locator('.details-more');
        await expect(more).toBeVisible();
        await expect(more).toHaveCSS('opacity', '1');
        await card.locator('.idea-card-bottom').hover();
        await page.waitForTimeout(1200);
        expect(await isExpanded()).toBe(false);
        await card.locator('.idea-card-body').hover();
        await expect.poll(isExpanded).toBe(true);
        await expect(more).toBeHidden();
        expect(await details.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
        await expect(card.getByRole('link', { name: 'Read the final reference' })).toHaveAttribute(
            'href',
            'https://example.com/reference'
        );
        expect(await card.locator('script').count()).toBe(0);
        // Hover expansion stays after the pointer leaves; Show less collapses it.
        await page.mouse.move(0, 0);
        await page.waitForTimeout(500);
        expect(await isExpanded()).toBe(true);
        await card.getByRole('button', { name: 'Show less', exact: true }).click();
        await page.mouse.move(0, 0);
        await expect.poll(isExpanded).toBe(false);
        await expect(more).toHaveCSS('opacity', '1');
        await card.getByRole('button', { name: /^Pin / }).hover();
        await page.waitForTimeout(1200);
        expect(await isExpanded()).toBe(false);
        await card.getByRole('button', { name: /^Archive / }).hover();
        await page.waitForTimeout(1200);
        expect(await isExpanded()).toBe(false);
        await card.getByRole('button', { name: 'Edit', exact: true }).hover();
        await expect.poll(isExpanded).toBe(false);
        await card.getByRole('button', { name: /^Create task from/ }).hover();
        await page.waitForTimeout(1200);
        expect(await isExpanded()).toBe(false);
        await page.mouse.move(0, 0);
        // Keyboard focus expands the details; mouse focus does not.
        await page.keyboard.press('Shift');
        await card.focus();
        await expect.poll(isExpanded).toBe(true);
        await card.evaluate((node) => node.blur());
        await expect(card.locator('.idea-details-toggle')).toBeHidden();
        await page.mouse.move(0, 0);
        await expect.poll(isExpanded).toBe(false);
        await page.reload();
        await card.getByRole('button', { name: 'Edit', exact: true }).click();
        await expect(dialog.getByRole('textbox', { name: 'Details', exact: true })).toHaveValue(body);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(card.locator('.idea-details-toggle')).toBeHidden();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });
}

test.describe('touch idea details', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

    test('tap expands and collapses the full formatted idea', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: 'New idea', exact: true }).tap();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Idea title', { exact: true }).fill('Touch Markdown example');
        await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill(body);
        await dialog.getByRole('button', { name: 'Save idea', exact: true }).tap();
        const card = page.getByRole('article', { name: 'Touch Markdown example', exact: true });
        const details = card.locator('.idea-details');
        const isExpanded = () => details.evaluate((node) => node.scrollHeight <= node.clientHeight + 1);
        await expect.poll(isExpanded).toBe(false);
        await card.getByRole('button', { name: 'Show details', exact: true }).tap();
        await expect.poll(isExpanded).toBe(true);
        await expect(card.locator('strong')).toHaveText('Important detail');
        expect(await details.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
        await card.getByRole('button', { name: 'Show less', exact: true }).tap();
        await expect.poll(isExpanded).toBe(false);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });

    test('hides Show details when the whole idea already fits', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: 'New idea', exact: true }).tap();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Idea title', { exact: true }).fill('Short touch idea');
        await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill('One short line.');
        await dialog.getByRole('button', { name: 'Save idea', exact: true }).tap();
        const card = page.getByRole('article', { name: 'Short touch idea', exact: true });
        await expect(card.locator('.idea-details')).toHaveAttribute('data-truncated', 'false');
        await expect(card.getByRole('button', { name: 'Show details', exact: true })).toBeHidden();
    });
});

test('shows no overflow indicator when idea details fit', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'New idea', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Idea title', { exact: true }).fill('Short idea');
    await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill('One short line.');
    await dialog.getByRole('button', { name: 'Save idea', exact: true }).click();
    const card = page.getByRole('article', { name: 'Short idea', exact: true });
    await expect(card.locator('.idea-details')).toHaveAttribute('data-truncated', 'false');
    await expect(card.locator('.details-more')).toBeHidden();
});
