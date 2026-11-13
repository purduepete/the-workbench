import { devices, expect, test } from './fixtures';
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
