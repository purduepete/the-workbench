import { expect, test, openEditor } from './fixtures';
import type { Page } from './fixtures';

const highlighted = (page: Page) =>
    page.evaluate(() => [...(CSS.highlights.get('search-match') ?? [])].map((range) => range.toString()));

test('search highlights matching text in ideas, notes and tasks and clears with the search', async ({ page }) => {
    const word = `Zephyr${crypto.randomUUID().slice(0, 6)}`;

    await page.goto('/ideas');
    await page.getByRole('button', { name: 'New idea', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title', { exact: true }).fill(`${word} idea`);
    await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill(`Has **${word.toLowerCase()}** in bold.`);
    await dialog.getByRole('button', { name: 'Save idea', exact: true }).click();
    const ideaSearch = page.getByRole('searchbox', { name: 'Search ideas' });
    await ideaSearch.fill(word.toLowerCase());
    await expect.poll(() => highlighted(page)).toEqual([word, word.toLowerCase()]);
    await ideaSearch.fill('');
    await expect.poll(() => highlighted(page)).toEqual([]);

    await page.goto('/notes');
    await openEditor(page, 'Global note');
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title', { exact: true }).fill(`Note about ${word}`);
    await dialog.getByRole('button', { name: 'Save note', exact: true }).click();
    await page
        .getByRole('group', { name: 'Filter notes', exact: true })
        .getByRole('button', { name: 'Global', exact: true })
        .click();
    await page.getByRole('searchbox', { name: 'Search notes' }).fill(word);
    await expect.poll(() => highlighted(page)).toContain(word);

    await page.goto('/tasks');
    await page.getByRole('button', { name: 'New task', exact: true }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(`Task ${word}`);
    await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search tasks' }).fill(word);
    await expect.poll(() => highlighted(page)).toEqual([word]);
});
