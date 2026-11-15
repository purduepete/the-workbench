import { chooseChip, devices, expect, test } from './fixtures';
import type { Locator } from './fixtures';

// Safari on iPhone: WebKit with touch input and no hover.
test.use({ ...devices['iPhone 13'], browserName: 'webkit', channel: '' });

const body = Array.from(
    { length: 8 },
    (_, index) => `Paragraph ${index + 1} with enough text to wrap on a phone.`
).join('\n\n');

async function checkToggle(container: Locator, details: Locator) {
    const isExpanded = () => details.evaluate((node) => node.scrollHeight <= node.clientHeight + 1);
    const toggle = container.locator('.idea-details-toggle, .task-details-toggle');
    const restingColor = await toggle.evaluate((node) => getComputedStyle(node).color);
    await container.getByRole('button', { name: 'Show details', exact: true }).tap();
    await expect.poll(isExpanded).toBe(true);
    await container.getByRole('button', { name: 'Show less', exact: true }).tap();
    await expect.poll(isExpanded).toBe(false);
    // A tap must not leave the button in its hover color.
    expect(await toggle.evaluate((node) => getComputedStyle(node).color)).toBe(restingColor);
}

for (const [route, opener] of [
    ['/notes', 'New note'],
    ['/tasks', 'New task'],
    ['/ideas', 'New idea'],
] as const) {
    test(`${route} filters and editor controls fit their rows at phone and larger widths`, async ({ page }) => {
        await page.goto(route);
        const filter = page.locator('.workspace-tools .page-pill');
        await expect(filter).toBeVisible();
        await page.getByRole('button', { name: opener, exact: true }).tap();
        const dialog = page.getByRole('dialog');
        const toolbar = dialog.locator('.markdown-editor-toolbar');

        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            const phone = width <= 540;
            for (const label of ['Notes', 'Tasks', 'Ideas']) {
                const link = page.getByRole('link', { name: label, exact: true });
                await expect(link.locator('svg')).toBeVisible();
                expect((await link.locator('.page-nav-label').boundingBox())?.width === 1).toBe(phone);
            }
            if (phone) {
                const sizes = await filter.evaluate((node) => {
                    const row = node.closest('.workspace-tools')!;
                    const style = getComputedStyle(row);
                    return {
                        filter: node.getBoundingClientRect().width,
                        row: row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
                    };
                });
                expect(sizes.filter).toBeCloseTo(sizes.row, 0);
            }
            const geometry = await toolbar.evaluate((node) => {
                const row = node.getBoundingClientRect();
                const mode = node.querySelector('.markdown-mode')!.getBoundingClientRect();
                const section = node.querySelector('.markdown-add-section')!.getBoundingClientRect();
                const image = node.querySelector('.image-link-editor > button')!.getBoundingClientRect();
                return {
                    left: mode.left - row.left,
                    right: row.right - image.right,
                    tops: [mode.top, section.top, image.top],
                    gaps: [section.left - mode.right, image.left - section.right],
                };
            });
            expect(geometry.left).toBeCloseTo(0, 0);
            expect(geometry.right).toBeCloseTo(0, 0);
            expect(geometry.tops[1]).toBeCloseTo(geometry.tops[0], 0);
            expect(geometry.tops[2]).toBeCloseTo(geometry.tops[0], 0);
            expect(geometry.gaps[0]).toBeGreaterThanOrEqual(8);
            expect(geometry.gaps[0]).toBeCloseTo(geometry.gaps[1], 0);
            expect(await toolbar.locator('.editor-action-full').first().isVisible()).toBe(!phone);
        }

        await page.setViewportSize({ width: 320, height: 900 });
        if (route === '/ideas') {
            await chooseChip(dialog, 'Solution', 'Solution Directory');
            await chooseChip(dialog, 'Status', 'In progress');
            await chooseChip(dialog, 'Priority', 'Medium');
            const metadata = await dialog.locator('.idea-editor-chips').evaluate((node) => {
                const row = node.getBoundingClientRect();
                const controls = [...node.querySelectorAll(':scope > button')].map((item) =>
                    item.getBoundingClientRect()
                );
                return {
                    fits: controls.every((item) => item.left >= row.left && item.right <= row.right),
                    sameRow: controls.every((item) => item.top === controls[0].top),
                    right: row.right - controls.at(-1)!.right,
                };
            });
            expect(metadata.fits).toBe(true);
            expect(metadata.sameRow).toBe(true);
            expect(metadata.right).toBeCloseTo(0, 0);
        }
        await dialog.getByRole('button', { name: 'Add image link', exact: true }).tap();
        const imageFields = dialog.getByRole('group', { name: 'OneDrive image link' });
        await expect(imageFields).toBeVisible();
        const expanded = await toolbar.evaluate((node) => {
            const row = node.getBoundingClientRect();
            const panel = node.querySelector('.image-link-fields')!.getBoundingClientRect();
            const trigger = node.querySelector('.image-link-editor > button')!.getBoundingClientRect();
            return { fits: panel.left >= row.left && panel.right <= row.right, below: panel.top >= trigger.bottom };
        });
        expect(expanded.fits).toBe(true);
        expect(expanded.below).toBe(true);
    });
}

test('task Show details and Show less keep working after editing', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByRole('button', { name: 'New task', exact: true }).tap();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title', { exact: true }).fill('Phone task');
    await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill(body);
    await dialog.getByRole('button', { name: 'Save task', exact: true }).tap();
    const row = page.getByRole('listitem', { name: 'Phone task', exact: true });
    const details = row.locator('.task-details');
    await checkToggle(row, details);
    await row.getByRole('button', { name: 'Edit Phone task', exact: true }).tap();
    await dialog.getByRole('button', { name: 'Save task', exact: true }).tap();
    await expect(dialog).toBeHidden();
    await checkToggle(row, details);
});

test('idea Show details and Show less keep working after editing', async ({ page }) => {
    await page.goto('/ideas');
    await page.getByRole('button', { name: 'New idea', exact: true }).tap();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title', { exact: true }).fill('Phone idea');
    await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill(body);
    await dialog.getByRole('button', { name: 'Save idea', exact: true }).tap();
    const card = page.getByRole('article', { name: 'Phone idea', exact: true });
    const details = card.locator('.idea-details');
    await checkToggle(card, details);
    await card.getByRole('button', { name: 'Edit', exact: true }).tap();
    await dialog.getByRole('button', { name: 'Save idea', exact: true }).tap();
    await expect(dialog).toBeHidden();
    await checkToggle(card, details);
});
