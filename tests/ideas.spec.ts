import { expect, test } from '@playwright/test';

test('capture, search, pin, edit and archive an idea', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Idea Notes' })).toBeVisible();
    await page.getByRole('button', { name: 'New idea' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.eyebrow')).toHaveCSS('text-transform', 'uppercase');
    await dialog.getByLabel('Idea title').fill('Sketch a reading nook');
    await dialog.getByLabel('Details').fill('Use the corner by the window and add a lamp.');
    await dialog.getByLabel('Tags').fill('home, reading');
    await dialog.getByRole('button', { name: 'Save idea' }).click();

    const card = page
        .locator('.idea-card')
        .filter({ has: page.getByRole('heading', { name: 'Sketch a reading nook' }) });
    await expect(card).toBeVisible();
    await page.reload();
    await expect(card).toBeVisible();
    await expect(card.getByText('Use the corner by the window and add a lamp.')).toBeVisible();
    await card.getByRole('button', { name: 'Pin Sketch a reading nook' }).click();
    await page.getByRole('button', { name: 'Filter by home' }).click();
    await expect(page.getByRole('heading', { name: 'Tagged “home”' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear tag' }).click();
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill('reading');
    await expect(card).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill('missing phrase');
    await expect(page.getByText('No ideas match this search')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill('');
    await card.getByRole('button', { name: 'Edit' }).click();
    await dialog.getByLabel('Idea title').fill('Reading nook plan');
    await dialog.getByRole('button', { name: 'Save idea' }).click();
    await expect(page.getByRole('heading', { name: 'Reading nook plan' })).toBeVisible();
    await page.getByRole('button', { name: 'All ideas' }).click();
    const updatedCard = page
        .locator('.idea-card')
        .filter({ has: page.getByRole('heading', { name: 'Reading nook plan' }) });
    await updatedCard.getByRole('button', { name: 'Archive Reading nook plan' }).click();
    await page.getByRole('button', { name: /Archived/ }).click();
    await expect(page.getByRole('heading', { name: 'Reading nook plan' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore Reading nook plan' }).click();
    await page.getByRole('button', { name: 'All ideas' }).click();
    await expect(page.getByRole('heading', { name: 'Reading nook plan' })).toBeVisible();
});

test('switches themes and keeps the page inside a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const heroHeading = page.getByRole('heading', { name: 'Catch the thought. Come back to it.' });
    await expect(page.locator('.stats')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Capture an idea' })).toHaveCount(0);
    await expect(heroHeading.locator('br')).toHaveCount(0);
    const headingWidth = await heroHeading.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
    }));
    expect(headingWidth.scrollWidth).toBeLessThanOrEqual(headingWidth.clientWidth);
    await expect(page.getByText(/Keep ideas, half-formed plans/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Theme: Midnight' }).click();
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveClass(/light/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ffffff');
    await page.getByRole('radio', { name: 'System' }).click();
    await expect(page.locator('html')).toHaveClass(/light/);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/theme-midnight/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#020617');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Theme: System' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test('keeps the desktop workspace compact', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const measurements = await page.evaluate(() => {
        const main = document.querySelector('main.page-width');
        const intro = document.querySelector('.intro');
        const toolbar = document.querySelector('.workspace-tools');
        const heading = intro?.querySelector('h2');
        if (!main || !intro || !toolbar || !heading) throw new Error('Workspace layout elements are missing.');
        return {
            mainTopPadding: parseFloat(getComputedStyle(main).paddingTop),
            introBottomPadding: parseFloat(getComputedStyle(intro).paddingBottom),
            toolbarMinimumHeight: parseFloat(getComputedStyle(toolbar).minHeight),
            headingFontSize: parseFloat(getComputedStyle(heading).fontSize),
        };
    });
    expect(measurements.mainTopPadding).toBeLessThanOrEqual(24);
    expect(measurements.introBottomPadding).toBeLessThanOrEqual(16);
    expect(measurements.toolbarMinimumHeight).toBeLessThanOrEqual(60);
    expect(measurements.headingFontSize).toBeLessThanOrEqual(26);
});

test('supports keyboard selection and dismissal in the theme menu', async ({ page }) => {
    await page.goto('/');
    const trigger = page.locator('.theme-wrap > button');
    await trigger.click();
    const midnight = page.getByRole('radio', { name: 'Midnight' });
    await expect(midnight).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'System' })).toBeFocused();
    await page.keyboard.press('Home');
    const light = page.getByRole('radio', { name: 'Light' });
    await expect(light).toBeFocused();
    await expect(light).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Appearance settings' })).toBeVisible();
    await trigger.click();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Theme: Light' }).click();
    await page.getByRole('heading', { name: 'Catch the thought. Come back to it.' }).click();
    await expect(page.getByRole('button', { name: 'Theme: Light' })).toHaveAttribute('aria-expanded', 'false');
});

test('keeps content edges aligned across desktop widths and reserves the scrollbar gutter', async ({ page }) => {
    for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 400 });
        await page.goto('/');
        const layout = await page.evaluate(() => {
            const header = document.querySelector('.topbar-inner');
            const main = document.querySelector('main.page-width');
            if (!header || !main) throw new Error('Page layout elements are missing.');
            const headerRect = header.getBoundingClientRect();
            const mainRect = main.getBoundingClientRect();
            const headerStyle = getComputedStyle(header);
            const mainStyle = getComputedStyle(main);
            return {
                layoutWidth: document.documentElement.getBoundingClientRect().width,
                clientWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                headerLeft: headerRect.left + parseFloat(headerStyle.paddingLeft),
                headerRight: headerRect.right - parseFloat(headerStyle.paddingRight),
                mainLeft: mainRect.left + parseFloat(mainStyle.paddingLeft),
                mainRight: mainRect.right - parseFloat(mainStyle.paddingRight),
                pageHeight: document.documentElement.scrollHeight,
                viewportHeight: window.innerHeight,
            };
        });
        const expectedEdge = Math.max(20, (layout.layoutWidth - 1440) / 2 + 20);
        expect(layout.headerLeft).toBeCloseTo(expectedEdge, 0);
        expect(layout.mainLeft).toBeCloseTo(expectedEdge, 0);
        expect(layout.headerRight).toBeCloseTo(layout.layoutWidth - expectedEdge, 0);
        expect(layout.mainRight).toBeCloseTo(layout.layoutWidth - expectedEdge, 0);
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
        expect(layout.pageHeight).toBeGreaterThan(layout.viewportHeight);

        await page.addStyleTag({
            content: '.topbar{position:static!important}main{display:none!important}body{min-height:0!important}',
        });
        const noScrollLayoutWidth = await page.evaluate(() => document.documentElement.getBoundingClientRect().width);
        expect(noScrollLayoutWidth).toBe(layout.layoutWidth);
    }
});
