import { expect, test } from '@playwright/test';

for (const theme of ['midnight', 'light']) {
    test(`idea and note tags share formatting in ${theme}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addInitScript((theme) => localStorage.setItem('the-workbench.theme-preference', theme), theme);
        const styles = [];
        for (const [path, opener, title, save, card] of [
            ['/', 'New idea', 'Idea title', 'Save idea', '.idea-card'],
            ['/notes', 'Global note', 'Title', 'Save note', '.global-note-card'],
        ]) {
            await page.goto(path);
            await page.getByRole('button', { name: opener, exact: true }).click();
            const dialog = page.getByRole('dialog');
            await dialog.getByLabel(title, { exact: true }).fill(`Tag format ${theme}`);
            await dialog.locator('input[name="tags"]').fill('example');
            await dialog.getByRole('button', { name: save, exact: true }).click();
            if (path === '/notes') await page.getByRole('button', { name: 'Global notes', exact: true }).click();
            const tag = page
                .locator(card)
                .filter({ hasText: `Tag format ${theme}` })
                .getByRole('button', { name: 'Filter by example', exact: true });
            await expect(tag).toBeVisible();
            await expect(tag.locator('svg')).toHaveAttribute('width', '10');
            styles.push(
                await tag.evaluate((node) => {
                    const style = getComputedStyle(node);
                    return [
                        'fontSize',
                        'fontWeight',
                        'padding',
                        'border',
                        'borderRadius',
                        'color',
                        'backgroundColor',
                        'gap',
                        'height',
                    ].map((property) =>
                        style.getPropertyValue(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`))
                    );
                })
            );
        }
        expect(styles[0]).toEqual(styles[1]);
    });
}
