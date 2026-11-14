import { expect, test, closeDialog, openEditor, openManageSolutions } from './fixtures';

test('uses The Workbench for the site and installed app', async ({ page, request }) => {
    await page.goto('/ideas');
    await expect(page).toHaveTitle('The Workbench');
    await expect(page.getByRole('heading', { name: 'The Workbench', exact: true })).toBeVisible();
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'The Workbench');
    const manifest = await request.get('/manifest.webmanifest');
    expect(manifest.ok()).toBe(true);
    expect(await manifest.json()).toMatchObject({ name: 'The Workbench', short_name: 'The Workbench' });
    await expect(page.locator('.brand-mark img')).toHaveAttribute('src', '/favicon.svg');
});

for (const theme of ['midnight', 'light']) {
    test(`site icon has no surrounding border in ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('the-workbench.theme-preference', value), theme);
        for (const width of [390, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/ideas');
            const mark = page.locator('.brand-mark');
            const icon = mark.locator('img');
            await expect(icon).toBeVisible();
            for (const element of [mark, icon]) {
                for (const side of ['top', 'right', 'bottom', 'left']) {
                    await expect(element).toHaveCSS(`border-${side}-width`, '0px');
                }
            }
            await expect(mark).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        }
    });

    for (const fails of [false, true]) {
        test(`header actions restore fill and color after ${fails ? 'failure' : 'success'} in ${theme}`, async ({
            page,
        }) => {
            await page.addInitScript((value) => localStorage.setItem('the-workbench.theme-preference', value), theme);
            await page.goto('/ideas');
            await expect(page.locator('.local-badge')).toHaveText('Synced');
            const refresh = page.getByRole('button', { name: 'Refresh ideas' });
            const themeButton = page.getByRole('button', { name: /^Theme:/ });
            // Sample colors only after the theme's color transitions settle.
            const settled = () =>
                page.evaluate(() =>
                    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
                );
            await settled();
            const idleColor = await refresh.evaluate((element) => getComputedStyle(element).color);
            const activeColor = await page.locator('html').evaluate((element) => getComputedStyle(element).color);
            for (const button of [refresh, themeButton]) {
                await expect(button).toHaveCSS('border-top-width', '0px');
                await button.hover();
                await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
                await expect(button).toHaveCSS('color', idleColor);
            }
            await themeButton.click();
            await expect(themeButton).toHaveAttribute('aria-expanded', 'true');
            await expect(themeButton).toHaveCSS('color', activeColor);
            const activeFill = await themeButton.evaluate((element) => getComputedStyle(element).backgroundColor);
            expect(activeFill).not.toBe('rgba(0, 0, 0, 0)');
            await themeButton.click();
            await expect(themeButton).toHaveAttribute('aria-expanded', 'false');
            await expect(themeButton).toHaveCSS('color', idleColor);
            await expect(themeButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

            let releaseSolutions: (() => void) | undefined;
            const solutionsReady = new Promise<void>((resolve) => {
                releaseSolutions = resolve;
            });
            await page.route('**/api/solutions', async (route) => {
                await solutionsReady;
                await route.continue();
            });
            await page.route('**/api/ideas', async (route) => {
                await route.fulfill({
                    status: fails ? 503 : 200,
                    contentType: 'application/json',
                    body: fails ? '{"error":"unavailable"}' : '{"ideas":[]}',
                });
            });
            await refresh.click();
            await expect(refresh).toHaveAttribute('aria-busy', 'true');
            await expect(refresh).toBeDisabled();
            await expect(refresh).toHaveCSS('color', activeColor);
            await expect(refresh).toHaveCSS('background-color', activeFill);
            await expect(refresh).toHaveCSS('border-top-width', '0px');
            if (!releaseSolutions) throw new Error('Solution refresh gate is missing.');
            releaseSolutions();
            await expect(refresh).toHaveAttribute('aria-busy', 'false');
            await expect(refresh).toBeEnabled();
            await expect(refresh).toHaveCSS('color', idleColor);
            await expect(refresh).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        });
    }

    test(`dialog close controls and idea top spacing in ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('the-workbench.theme-preference', value), theme);
        for (const width of [390, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/ideas');
            for (const opener of ['New idea', 'Manage solutions']) {
                if (opener === 'New idea') await page.getByRole('button', { name: opener, exact: true }).click();
                else await openManageSolutions(page);
                const dialog = page.getByRole('dialog', { name: opener });
                if (opener === 'New idea') {
                    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
                    const form = dialog.locator('form.idea-form');
                    const heading = form.locator('.dialog-heading');
                    const title = form.locator('.editor-title-input');
                    const chips = form.locator('.editor-chips');
                    await expect(heading).toHaveCSS('margin-top', '0px');
                    const formBox = await form.boundingBox();
                    const headingBox = await heading.boundingBox();
                    const titleBox = await title.boundingBox();
                    const chipsBox = await chips.boundingBox();
                    if (!formBox || !headingBox || !titleBox || !chipsBox)
                        throw new Error('Idea form fields are missing.');
                    const paddingTop = await form.evaluate((element) =>
                        parseFloat(getComputedStyle(element).paddingTop)
                    );
                    // The heading starts at the form's top padding, with the title and chips below it in order.
                    expect(headingBox.y - formBox.y).toBeCloseTo(paddingTop, 0);
                    expect(titleBox.y).toBeGreaterThanOrEqual(headingBox.y + headingBox.height - 1);
                    expect(chipsBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
                    await closeDialog(dialog);
                    await expect(dialog).toHaveCount(0);
                    continue;
                }
                await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
                await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
                await closeDialog(dialog);
                await expect(dialog).toHaveCount(0);
            }
        }
    });
}

test('positions desktop dialogs near the top and keeps their controls usable', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/ideas');
    await page.getByRole('button', { name: 'New idea' }).click();
    const newDialog = page.getByRole('dialog', { name: 'New idea' });
    await newDialog.getByLabel('Title', { exact: true }).fill('Desktop dialog positioning');
    await newDialog.getByRole('button', { name: 'Save idea' }).click();
    const card = page.locator('.idea-card').filter({
        has: page.getByRole('heading', { name: 'Desktop dialog positioning', exact: true }),
    });
    await expect(card).toBeVisible();

    for (const viewport of [
        { width: 900, height: 600 },
        { width: 1280, height: 720 },
        { width: 1440, height: 900 },
        { width: 1920, height: 1080 },
    ]) {
        await page.setViewportSize(viewport);
        for (const name of ['New idea', 'Edit idea', 'Manage solutions']) {
            if (name === 'Manage solutions') await openManageSolutions(page);
            else if (name === 'Edit idea') await card.getByRole('button', { name: 'Edit' }).click();
            else await page.getByRole('button', { name, exact: true }).click();
            const dialog = page.getByRole('dialog', { name });
            const box = await dialog.boundingBox();
            if (!box) throw new Error(`${name} dialog is missing.`);
            expect(box.y).toBeCloseTo(Math.min(40, Math.max(16, viewport.height * 0.04)), 0);
            expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 15);

            if (name === 'New idea') {
                const trigger = dialog.getByRole('button', { name: /^Solution:/ });
                await trigger.click();
                const listbox = page.getByRole('listbox', { name: 'Solution' });
                const panelBox = await listbox.boundingBox();
                const triggerBox = await trigger.boundingBox();
                if (!panelBox || !triggerBox) throw new Error('Solution dropdown is missing.');
                expect(panelBox.x).toBeCloseTo(triggerBox.x, 0);
                const below = Math.abs(panelBox.y - (triggerBox.y + triggerBox.height + 4)) < 1;
                const above = Math.abs(panelBox.y + panelBox.height - (triggerBox.y - 4)) < 1;
                expect(below || above).toBe(true);
                await listbox.getByRole('option', { name: 'Ferry Tracker' }).click();
                await expect(trigger).toContainText('Ferry Tracker');
            }
            await closeDialog(dialog);
        }
    }
});

test('expands new and existing idea editors on desktop without hiding controls', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/ideas');
    await page.getByRole('button', { name: 'New idea', exact: true }).click();
    const newDialog = page.getByRole('dialog', { name: 'New idea' });
    await newDialog.getByLabel('Title', { exact: true }).fill('Desktop editor size');
    await newDialog.getByRole('textbox', { name: 'Details', exact: true }).fill('Existing details');
    await newDialog.getByRole('button', { name: 'Save idea' }).click();
    const card = page.locator('.idea-card').filter({
        has: page.getByRole('heading', { name: 'Desktop editor size', exact: true }),
    });
    await expect(card).toBeVisible();

    for (const viewport of [
        { width: 1280, height: 720 },
        { width: 1280, height: 900 },
        { width: 1920, height: 1080 },
    ]) {
        await page.setViewportSize(viewport);
        for (const name of ['New idea', 'Edit idea']) {
            const opener =
                name === 'Edit idea'
                    ? card.getByRole('button', { name: 'Edit', exact: true })
                    : page.getByRole('button', { name, exact: true });
            await opener.click();
            const dialog = page.getByRole('dialog', { name });
            const details = dialog.getByRole('textbox', { name: 'Details', exact: true });
            const save = dialog.getByRole('button', { name: 'Save idea' });
            const dialogBox = await dialog.boundingBox();
            const detailsBox = await details.boundingBox();
            const saveBox = await save.boundingBox();
            if (!dialogBox || !detailsBox || !saveBox) throw new Error('Idea editor controls are missing.');
            expect(dialogBox.height).toBeCloseTo(Math.min(960, viewport.height * 0.92), 0);
            expect(detailsBox.height).toBeGreaterThan(200);
            expect(saveBox.y).toBeGreaterThanOrEqual(dialogBox.y);
            expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height);
            const overflow = await dialog.evaluate((element) => element.scrollHeight - element.clientHeight);
            expect(overflow).toBeLessThanOrEqual(1);
            if (name === 'Edit idea') await expect(details).toHaveValue('Existing details');
            await closeDialog(dialog);
        }
    }
});

test('keeps a tall desktop dialog scrollable inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto('/ideas');
    await page.getByRole('button', { name: 'New idea' }).click();
    const dialog = page.getByRole('dialog', { name: 'New idea' });
    await dialog.getByRole('textbox', { name: 'Details', exact: true }).evaluate((element) => {
        if (!(element instanceof HTMLTextAreaElement)) throw new Error('Details field is missing.');
        element.style.height = '800px';
    });
    const dimensions = await dialog.evaluate((element) => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    const save = dialog.getByRole('button', { name: 'Save idea' });
    await save.scrollIntoViewIfNeeded();
    const dialogBox = await dialog.boundingBox();
    const saveBox = await save.boundingBox();
    if (!dialogBox || !saveBox) throw new Error('Dialog or Save button is missing.');
    expect(dialogBox.y).toBeCloseTo(19.2, 0);
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(480 - 15);
    expect(saveBox.y).toBeGreaterThanOrEqual(dialogBox.y);
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height);
});

test.describe('touch dialog placement', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('editors fit tablets without scrolling and give details the remaining height', async ({ page }) => {
        // Opens 16 editors; allow for a loaded machine.
        test.setTimeout(90_000);
        const editors = [
            { path: '/ideas', open: 'New idea' },
            { path: '/notes', open: 'New note' },
            { path: '/notes', open: 'Global note' },
            { path: '/tasks', open: 'New task' },
        ];
        for (const viewport of [
            { width: 810, height: 1080 },
            { width: 1080, height: 810 },
            { width: 1194, height: 834 },
            { width: 390, height: 844 },
        ]) {
            await page.setViewportSize(viewport);
            for (const editor of editors) {
                await page.goto(editor.path);
                await openEditor(page, editor.open, 'tap');
                const dialog = page.getByRole('dialog');
                const details = await dialog.getByRole('textbox', { name: 'Details', exact: true }).boundingBox();
                if (!details) throw new Error(`${editor.open} details field is missing.`);
                expect(details.height).toBeGreaterThanOrEqual(150);
                // The opened dialog takes focus without drawing a focus ring around the whole modal.
                expect(await dialog.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
                if (viewport.width > 390)
                    expect(
                        await dialog.evaluate((element) => element.scrollHeight - element.clientHeight)
                    ).toBeLessThanOrEqual(1);
                await dialog.getByRole('button', { name: 'Close', exact: true }).tap();
            }
        }
    });

    test('keeps phone and tablet dialogs centered', async ({ page }) => {
        for (const viewport of [
            { width: 390, height: 844 },
            { width: 1280, height: 900 },
        ]) {
            await page.setViewportSize(viewport);
            await page.goto('/ideas');
            expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
            for (const name of ['New idea', 'Manage solutions']) {
                if (name === 'New idea') await page.getByRole('button', { name, exact: true }).click();
                else await openManageSolutions(page);
                const dialog = page.getByRole('dialog', { name });
                const box = await dialog.boundingBox();
                if (!box) throw new Error(`${name} dialog is missing.`);
                expect(box.y).toBeCloseTo((viewport.height - box.height) / 2, 0);
                await closeDialog(dialog);
            }
        }
    });
});

for (const device of [
    { name: 'desktop', platform: 'Win32', userAgent: 'Mozilla/5.0 Windows NT 10.0', maxTouchPoints: 0, touch: false },
    {
        name: 'iPhone',
        platform: 'iPhone',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',
        maxTouchPoints: 5,
        touch: true,
    },
    { name: 'iPad', platform: 'iPad', userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0)', maxTouchPoints: 5, touch: true },
    {
        name: 'desktop-UA iPad',
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
        maxTouchPoints: 5,
        touch: true,
    },
]) {
    test(`modal opening focus stays keyboard-free on ${device.name}`, async ({ page }) => {
        await page.addInitScript(({ platform, userAgent, maxTouchPoints }) => {
            Object.defineProperty(navigator, 'platform', { value: platform });
            Object.defineProperty(navigator, 'userAgent', { value: userAgent });
            Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints });
        }, device);
        await page.goto('/ideas');
        await page.evaluate(() => {
            document.addEventListener('focusin', (event) => {
                if (
                    event.target instanceof Element &&
                    event.target.matches('dialog input, dialog textarea, dialog [contenteditable]')
                ) {
                    document.documentElement.dataset.ideaInputFocused = 'true';
                }
            });
        });
        const opener = page.getByRole('button', { name: 'New idea' });
        await opener.click();
        const dialog = page.getByRole('dialog', { name: 'New idea' });
        const title = dialog.getByLabel('Title', { exact: true });
        await expect(device.touch ? dialog : title).toBeFocused();
        if (device.touch) {
            await expect(page.locator('html')).not.toHaveAttribute('data-idea-input-focused', 'true');
            // One Tab reaches the title; the corner buttons come last.
            await page.keyboard.press('Tab');
            await expect(title).toBeFocused();
        }
        await title.click();
        await expect(title).toBeFocused();
        const ideaTitle = `Modal focus test ${device.name}`;
        await title.fill(ideaTitle);
        await dialog.getByRole('button', { name: 'Save idea' }).click();
        const card = page.locator('.idea-card').filter({
            has: page.getByRole('heading', { name: ideaTitle, exact: true }),
        });
        const edit = card.getByRole('button', { name: 'Edit' });
        await page.evaluate(() => {
            delete document.documentElement.dataset.ideaInputFocused;
        });
        await edit.click();
        const editDialog = page.getByRole('dialog', { name: 'Edit idea' });
        await expect(device.touch ? editDialog : editDialog.getByLabel('Title', { exact: true })).toBeFocused();
        if (device.touch) await expect(page.locator('html')).not.toHaveAttribute('data-idea-input-focused', 'true');
        await expect(editDialog.locator('form.idea-form .dialog-heading')).toHaveCSS('margin-top', '0px');
        await expect(editDialog.getByLabel('Title', { exact: true })).toHaveValue(ideaTitle);
        // An unchanged saved idea closes on Escape without asking to discard.
        await page.keyboard.press('Escape');
        await expect(editDialog).toHaveCount(0);
        await expect(edit).toBeFocused();
    });
}

test('keeps the initial loading state until a failed sync succeeds on retry', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.removeItem('the-workbench.sync');
        localStorage.removeItem('the-workbench.ideas');
    });
    let attempts = 0;
    await page.route('**/api/ideas', async (route) => {
        attempts += 1;
        if (attempts === 1) {
            await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' });
            return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ideas":[]}' });
    });

    await page.goto('/ideas');
    await expect(page.getByRole('status').filter({ hasText: 'Loading ideas' })).toBeVisible();
    await expect(page.locator('.page-loading-message')).toHaveText('Ideas could not sync. Retrying automatically.');
    await expect(page.getByRole('heading', { name: 'No ideas yet' })).toHaveCount(0);

    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByRole('heading', { name: 'No ideas yet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Capture your first idea' })).toHaveCount(0);
    expect(attempts).toBe(2);
});

test('capture, search, pin, edit and archive an idea', async ({ page }) => {
    await page.goto('/ideas');
    await expect(page.getByRole('heading', { name: 'The Workbench' })).toBeVisible();
    await page.getByRole('button', { name: 'New idea' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title', { exact: true }).fill('Sketch a reading nook');
    await dialog
        .getByRole('textbox', { name: 'Details', exact: true })
        .fill('Use the corner by the window and add a lamp.');
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
    await expect(page.locator('.tag-filter-row').getByRole('button', { name: 'home', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await page.getByRole('button', { name: 'Clear tag' }).click();
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill('reading');
    await expect(card).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill('missing phrase');
    await expect(page.getByText('No ideas match this search')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill('');
    await card.getByRole('button', { name: 'Edit' }).click();
    await dialog.getByLabel('Title', { exact: true }).fill('Reading nook plan');
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
    await page.goto('/ideas');
    const brandHeading = page.getByRole('heading', { name: 'The Workbench', exact: true });
    await expect(page.locator('.stats')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Capture an idea' })).toHaveCount(0);
    await expect(brandHeading.locator('br')).toHaveCount(0);
    await expect(page.locator('.brand-mark img')).toBeVisible();
    await expect(page.getByText(/Keep ideas, half-formed plans/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Theme: Midnight' }).click();
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveClass(/light/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ffffff');
    await expect(page.locator('.brand-mark img')).toHaveAttribute('src', '/favicon-light.svg');
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon-light.svg');
    await page.getByRole('radio', { name: 'System' }).click();
    await expect(page.locator('html')).toHaveClass(/light/);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/theme-midnight/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#020617');
    await expect(page.locator('.brand-mark img')).toHaveAttribute('src', '/favicon.svg');
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
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
    await page.goto('/ideas');
    await expect(page.locator('.workspace-tools')).toBeVisible();
    const measurements = await page.evaluate(() => {
        const main = document.querySelector('main.page-width');
        const toolbar = document.querySelector('.workspace-tools');
        if (!main || !toolbar) throw new Error('Workspace layout elements are missing.');
        const mainTopPadding = parseFloat(getComputedStyle(main).paddingTop);
        return {
            mainTopPadding,
            // The sync status moved to the header, so the toolbar sits right below the page padding.
            toolbarOffset: toolbar.getBoundingClientRect().top - main.getBoundingClientRect().top - mainTopPadding,
            toolbarMinimumHeight: parseFloat(getComputedStyle(toolbar).minHeight),
        };
    });
    await expect(page.locator('.intro')).toHaveCount(0);
    expect(measurements.mainTopPadding).toBeLessThanOrEqual(24);
    expect(measurements.toolbarOffset).toBeLessThanOrEqual(16);
    expect(measurements.toolbarMinimumHeight).toBeLessThanOrEqual(60);
});

test('supports keyboard selection and dismissal in the theme menu', async ({ page }) => {
    await page.goto('/ideas');
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
    // A click on empty page space outside the menu dismisses it.
    await page.locator('main').click({ position: { x: 4, y: 4 } });
    await expect(page.getByRole('button', { name: 'Theme: Light' })).toHaveAttribute('aria-expanded', 'false');
});

test('keeps content edges aligned across desktop widths and reserves the scrollbar gutter', async ({ page }) => {
    for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 400 });
        await page.goto('/ideas');
        // Measure after the first sync renders the workspace; the loading overlay alone does not scroll.
        await expect(page.locator('.workspace-tools')).toBeVisible();
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
