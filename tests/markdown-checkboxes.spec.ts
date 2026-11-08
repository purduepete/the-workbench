import { expect, test } from '@playwright/test';

const body = ['Shopping', '', '- [ ] Buy milk', '- [x] Call Sam'].join('\n');

test('ticking an idea checklist item saves it, survives reload and stays read-only in preview', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'New idea', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Idea title', { exact: true }).fill('Checklist idea');
    await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill(body);
    await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Buy milk', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Save idea', exact: true }).click();

    const card = page.getByRole('article', { name: 'Checklist idea', exact: true });
    const milk = card.getByRole('checkbox', { name: 'Buy milk', exact: true });
    const sam = card.getByRole('checkbox', { name: 'Call Sam', exact: true });
    await expect(milk).not.toBeChecked();
    await expect(sam).toBeChecked();
    await expect(card.locator('.task-list-item[data-checked="true"] .markdown-task-text')).toHaveCSS(
        'text-decoration-line',
        'line-through'
    );
    await milk.click();
    await expect(milk).toBeChecked();
    await sam.click();
    await expect(sam).not.toBeChecked();

    await expect
        .poll(async () => {
            const response = await page.request.get('/api/ideas');
            const { ideas } = (await response.json()) as { ideas: { title: string; body: string }[] };
            return ideas.find((idea) => idea.title === 'Checklist idea')?.body;
        })
        .toBe(['Shopping', '', '- [x] Buy milk', '- [ ] Call Sam'].join('\n'));
    await page.reload();
    await expect(
        page.getByRole('article', { name: 'Checklist idea' }).getByRole('checkbox', { name: 'Buy milk' })
    ).toBeChecked();
});

test('ticking a task checklist item saves the task details', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/tasks');
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Task title', { exact: true }).fill('Checklist task');
    await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill(body);
    await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
    const row = page.getByRole('listitem', { name: 'Checklist task', exact: true });
    const milk = row.getByRole('checkbox', { name: 'Buy milk', exact: true });
    await milk.click();
    await expect(milk).toBeChecked();
    await expect(row.getByRole('checkbox', { name: 'Complete Checklist task', exact: true })).not.toBeChecked();
    await page.reload();
    await expect(
        page.getByRole('listitem', { name: 'Checklist task' }).getByRole('checkbox', { name: 'Buy milk' })
    ).toBeChecked();
});

test('clicking task checkboxes neither expands the details nor focuses the row open', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/tasks');
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Task title', { exact: true }).fill('Long checklist task');
    const items = ['Gutters', 'Furnace filter', 'Smoke alarms', 'Paint fence', 'Rake leaves'];
    await dialog
        .getByRole('textbox', { name: 'Details', exact: true })
        .fill(items.map((item) => `- [ ] ${item}`).join('\n'));
    await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
    const row = page.getByRole('listitem', { name: 'Long checklist task', exact: true });
    const details = row.locator('.task-details');
    const isExpanded = () => details.evaluate((node) => node.scrollHeight <= node.clientHeight + 1);
    await page.mouse.move(0, 0);
    await expect.poll(isExpanded).toBe(false);

    // Click a checklist box and leave the pointer resting on it past the hover delay.
    await row.getByRole('checkbox', { name: 'Gutters', exact: true }).click();
    await page.waitForTimeout(1500);
    await expect(row.getByRole('checkbox', { name: 'Gutters', exact: true })).toBeChecked();
    expect(await isExpanded()).toBe(false);

    // Completing the task with the mouse leaves it collapsed, even when the row itself receives focus (Safari).
    await row.getByRole('checkbox', { name: 'Complete Long checklist task', exact: true }).click();
    await row.evaluate((node) => (node as HTMLElement).focus());
    await page.waitForTimeout(500);
    await expect(row).toHaveAttribute('data-completed', 'true');
    expect(await isExpanded()).toBe(false);
});
