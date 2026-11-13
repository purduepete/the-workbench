import { expect, test, closeDialog, openEditor } from './fixtures';
import type { Locator } from './fixtures';

async function expectMarkerPainted(item: Locator) {
    await item.scrollIntoViewIfNeeded();
    const box = await item.boundingBox();
    if (!box) throw new Error('List item is not visible.');
    const font = await item.evaluate((element) => {
        const style = getComputedStyle(element);
        return { size: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
    });
    const x = Math.max(0, Math.floor(box.x - 1.5 * font.size));
    const width = Math.floor(box.x) - x - 1;
    if (width <= 0 || !Number.isFinite(font.line)) throw new Error('List marker has no visible area.');
    const screenshot = await item.page().screenshot({
        animations: 'disabled',
        clip: { x, y: Math.max(0, Math.floor(box.y)), width, height: Math.ceil(Math.min(box.height, font.line)) },
    });
    const visiblePixels = await item.page().evaluate(async (encoded) => {
        const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable.');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let i = 4; i < pixels.length; i += 4) {
            const difference = Math.max(
                Math.abs(pixels[i] - pixels[0]),
                Math.abs(pixels[i + 1] - pixels[1]),
                Math.abs(pixels[i + 2] - pixels[2])
            );
            if (difference > 50) count++;
        }
        return count;
    }, screenshot.toString('base64'));
    expect(visiblePixels).toBeGreaterThan(1);
}

async function expectMarkdownListMarkers(container: Locator) {
    const list = container.locator('ul').first();
    const outer = list.locator(':scope > li').first();
    const nested = outer.locator('ul').first().locator(':scope > li').first();
    const deep = nested.locator('ul').first().locator(':scope > li').first();
    const numbered = container.locator('ol').first();
    await expect(numbered).toHaveAttribute('start', '3');

    for (const [item, style] of [
        [outer, 'disc'],
        [nested, 'circle'],
        [deep, 'square'],
        [numbered.locator(':scope > li').first(), 'decimal'],
    ] as const) {
        await expect(item).toHaveCSS('display', 'list-item');
        await expect(item).toHaveCSS('list-style-type', style);
        const marker = await item.evaluate((element) => ({
            content: getComputedStyle(element, '::marker').content,
            color: getComputedStyle(element, '::marker').color,
            textColor: getComputedStyle(element).color,
        }));
        expect(marker.content).toBe('normal');
        expect(marker.color).toBe(marker.textColor);
    }
    await expectMarkerPainted(outer);
    await expectMarkerPainted(numbered.locator(':scope > li').first());
}

test('the calendar sits in the notes toolbar and hides under Global, which has no dates', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/notes');
    const filter = page.getByRole('group', { name: 'Filter notes', exact: true });
    await expect(filter.getByRole('button')).toHaveText(['Global', 'Home', 'Work']);
    await expect(filter.getByRole('button', { name: 'Work', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.notes-actions > button')).toHaveText(['Calendar']);
    await expect(page.getByRole('button', { name: 'Global note', exact: true })).toHaveCount(0);
    await filter.getByRole('button', { name: 'Global', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'New note', exact: true })).toBeVisible();
    await expect(
        dialog.getByRole('group', { name: 'Note category' }).getByRole('button', { name: 'Global', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
});
test('empty pages omit the long instructional copy', async ({ page }) => {
    const copy = [
        'Start with a quick note. Add the context now, and sort it out later.',
        'Write one entry a day. Notes are grouped by week, newest first.',
        'Add a task for today or choose a day from the calendar.',
    ];
    for (const route of ['/ideas', '/notes', '/tasks']) {
        await page.goto(route);
        for (const text of copy) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
        await expect(page.locator('.empty-state button')).toHaveCount(0);
    }
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
    test(`note editors keep the expected opening focus on ${device.name}`, async ({ page }) => {
        await page.addInitScript(({ platform, userAgent, maxTouchPoints }) => {
            Object.defineProperty(navigator, 'platform', { value: platform });
            Object.defineProperty(navigator, 'userAgent', { value: userAgent });
            Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints });
        }, device);
        await page.goto('/notes');
        await page.evaluate(() => {
            document.addEventListener('focusin', (event) => {
                if (
                    event.target instanceof Element &&
                    event.target.matches('dialog input, dialog textarea, dialog [contenteditable]')
                ) {
                    document.documentElement.dataset.noteInputFocused = 'true';
                }
            });
        });

        for (const editor of [{ button: 'New note', focus: 'Details' }]) {
            await page.evaluate(() => {
                delete document.documentElement.dataset.noteInputFocused;
            });
            const opener = page.getByRole('button', { name: editor.button, exact: true });
            await opener.click();
            const dialog = page.getByRole('dialog');
            await expect(device.touch ? dialog : dialog.getByRole('textbox', { name: editor.focus })).toBeFocused();
            if (device.touch) await expect(page.locator('html')).not.toHaveAttribute('data-note-input-focused', 'true');
            await closeDialog(dialog);
            await expect(opener).toBeFocused();
        }
    });
}

for (const theme of ['midnight', 'light']) {
    test(`notes page saves today's entry and keeps it after reload in ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('the-workbench.theme-preference', value), theme);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/ideas');
        const nav = page.getByRole('navigation', { name: 'Pages' });
        await nav.getByRole('link', { name: 'Notes' }).click();
        await expect(page).toHaveURL(/\/notes$/);
        await expect(nav.getByRole('link', { name: 'Notes' })).toHaveAttribute('aria-current', 'page');

        const body = `Walked the dog in ${theme}`;
        const newNote = page.getByRole('button', { name: 'New note', exact: true });
        await expect(newNote).toHaveText('New note');
        await newNote.click();
        const dialog = page.getByRole('dialog');
        await dialog.locator('textarea[name="body"]').fill(body);
        await dialog.locator('input[name="tags"]').fill('health, Family');
        await dialog.getByRole('button', { name: 'Save note' }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByRole('paragraph').filter({ hasText: body })).toBeVisible();
        await expect(page.getByText(/^Week of \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
        await expect(page.getByRole('status').first()).toHaveText('Synced');

        await page.reload();
        await expect(page).toHaveURL(/\/notes$/);
        await expect(page.getByRole('paragraph').filter({ hasText: body })).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);

        await page.goBack().catch(() => undefined);
        await page.goto('/ideas');
        await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Notes' }).click();
        await page.goBack();
        await expect(page).toHaveURL(/\/ideas$/);
        await expect(page.getByRole('button', { name: 'New idea' })).toBeVisible();
    });
}

test('calendar scrolls to a day with notes and opens a new note for an empty day', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/notes');
    const now = new Date();
    const todayLabel = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayLabel = `${String(yesterday.getMonth() + 1).padStart(2, '0')}/${String(yesterday.getDate()).padStart(2, '0')}/${yesterday.getFullYear()}`;

    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const todayEntry = page.getByRole('dialog');
    await todayEntry.locator('textarea[name="body"]').fill('Calendar existing-day entry');
    await todayEntry.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByRole('paragraph').filter({ hasText: 'Calendar existing-day entry' })).toBeVisible();

    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const calendar = page.getByRole('dialog', { name: 'Choose a day' });
    await expect(calendar.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await expect(calendar.getByRole('button', { name: /^Open / })).toHaveCount(0);
    const todayButton = calendar.getByRole('button', { name: todayLabel, exact: true });
    await expect(todayButton).toHaveAttribute('data-has-entry', 'true');
    await todayButton.press('ArrowLeft');
    await expect(calendar.getByRole('button', { name: yesterdayLabel, exact: true })).toBeFocused();
    await expect(calendar.getByRole('button', { name: yesterdayLabel, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await calendar.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(calendar).toBeVisible();
    await expect(calendar.getByRole('button', { name: todayLabel, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await expect(page.getByRole('dialog', { name: /^New note for / })).toHaveCount(0);
    // A day that has notes scrolls to them instead of opening an editor.
    await calendar.getByRole('button', { name: todayLabel, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('region', { name: `Notes for ${todayLabel}` })).toBeInViewport();

    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const secondCalendar = page.getByRole('dialog', { name: 'Choose a day' });
    const emptyDay = secondCalendar.getByRole('button', { name: yesterdayLabel, exact: true });
    await expect(emptyDay).toHaveAttribute('data-has-entry', 'false');
    await emptyDay.click();
    await expect(page.getByRole('dialog', { name: `New note for ${yesterdayLabel}` })).toBeVisible();
    await expect(page.getByRole('dialog').locator('textarea[name="body"]')).toHaveValue('');
});

test('calendar arrow keys move between days wherever focus is in the dialog', async ({ page }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const calendar = page.getByRole('dialog', { name: 'Choose a day' });
    const previous = calendar.getByRole('button', { name: 'Previous month', exact: true });
    await previous.click();
    await previous.click();
    const shown = (await calendar.locator('.calendar-month strong').textContent()) ?? '';
    const [month, year] = shown.split('/');
    await previous.focus();
    await page.keyboard.press('ArrowRight');
    const first = calendar.getByRole('button', { name: `${month}/01/${year}`, exact: true });
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await calendar.locator('h2').click();
    await page.keyboard.press('ArrowDown');
    await expect(calendar.getByRole('button', { name: `${month}/08/${year}`, exact: true })).toBeFocused();
    expect(await page.evaluate(() => String(getSelection()))).toBe('');
    await page.keyboard.press('Escape');
    await expect(calendar).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toBeFocused();
});

test('editors keep text open through Escape, backdrop and browser Back', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/ideas');
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Notes' }).click();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    const initialBox = await dialog.boundingBox();
    expect(initialBox?.width).toBeCloseTo(1100, 0);
    const body = dialog.locator('textarea[name="body"]');
    await body.fill('Draft text must stay open');

    for (let index = 0; index < 3; index += 1) await body.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(body).toHaveValue('Draft text must stay open');
    await page.mouse.click(5, 400);
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/notes$/);
    await expect(dialog).toBeVisible();

    // The X asks before discarding text.
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(body).toHaveValue('Draft text must stay open');
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.goBack();
    await expect(page).toHaveURL(/\/ideas$/);

    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Ideas' }).click();
    await page.getByRole('button', { name: 'New idea' }).click();
    const ideaDialog = page.getByRole('dialog', { name: 'New idea' });
    await expect(ideaDialog).toHaveJSProperty('open', true);
    const ideaBox = await ideaDialog.boundingBox();
    expect(ideaBox?.width).toBeCloseTo(1100, 0);
    await ideaDialog.locator('input[name="title"]').fill('Protected idea');
    for (let index = 0; index < 3; index += 1) await ideaDialog.locator('input[name="title"]').press('Escape');
    await expect(ideaDialog).toBeVisible();
    await ideaDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(ideaDialog).toBeVisible();
    // Clicking elsewhere cancels the pending discard.
    await ideaDialog.locator('input[name="title"]').click();
    await expect(ideaDialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await ideaDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await ideaDialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(ideaDialog).toBeHidden();
});

test('idea, note and task editors share the same desktop height', async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const editors = [
        { path: '/ideas', open: 'New idea', save: 'Save idea', markdown: true },
        { path: '/notes', open: 'New note', save: 'Save note', markdown: true },
        { path: '/notes', open: 'Global note', save: 'Save note', markdown: true },
        { path: '/tasks', open: 'New task', save: 'Save task', markdown: true },
    ];

    for (const viewport of [
        { width: 1280, height: 480 },
        { width: 1280, height: 720 },
        { width: 1280, height: 900 },
        { width: 1920, height: 1080 },
    ]) {
        await page.setViewportSize(viewport);
        for (const editor of editors) {
            await page.goto(editor.path);
            await openEditor(page, editor.open);
            const dialog = page.getByRole('dialog');
            const body = dialog.locator('textarea[name="body"]');
            const save = dialog.getByRole('button', { name: editor.save, exact: true });
            const dialogBox = await dialog.boundingBox();
            const bodyBox = await body.boundingBox();
            const saveBox = await save.boundingBox();
            if (!dialogBox || !bodyBox || !saveBox) throw new Error(`${editor.open} controls are missing.`);
            expect(dialogBox.height).toBeCloseTo(Math.min(960, viewport.height * 0.92), 0);
            expect(bodyBox.height).toBeGreaterThanOrEqual(150);
            expect(bodyBox.y + bodyBox.height).toBeLessThanOrEqual(saveBox.y);
            const overflow = await dialog.evaluate((element) => element.scrollHeight - element.clientHeight);
            if (viewport.height === 480) {
                expect(overflow).toBeGreaterThan(0);
                await save.scrollIntoViewIfNeeded();
                const visibleSaveBox = await save.boundingBox();
                if (!visibleSaveBox) throw new Error(`${editor.open} save button is missing.`);
                expect(visibleSaveBox.y + visibleSaveBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height);
            } else {
                expect(overflow).toBeLessThanOrEqual(1);
                expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height);
            }

            if (editor.markdown) {
                const text = Array(40).fill('A paragraph.').join('\n\n');
                await body.fill(text);
                await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
                expect((await dialog.boundingBox())?.height).toBeCloseTo(dialogBox.height, 0);
                const preview = dialog.locator('.markdown-editor-preview');
                await expect(preview).toHaveCSS('overflow-y', 'auto');
                expect(await preview.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
                    await preview.evaluate((element) => element.clientHeight)
                );
                const previewBox = await preview.boundingBox();
                const previewSaveBox = await save.boundingBox();
                if (!previewBox || !previewSaveBox) throw new Error(`${editor.open} preview controls are missing.`);
                expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(previewSaveBox.y);
                await save.scrollIntoViewIfNeeded();
                const visibleSaveBox = await save.boundingBox();
                if (!visibleSaveBox) throw new Error(`${editor.open} save button is missing.`);
                expect(visibleSaveBox.y + visibleSaveBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height);
                await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
                await expect(body).toHaveValue(text);
            }
            await closeDialog(dialog);
        }
    }
});

test('daily note sections expand and collapse together from the date header', async ({ page }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const editor = page.getByRole('dialog');
    await editor
        .locator('textarea[name="body"]')
        .fill('## Standup\nNotes one\n\n## Planning\nNotes two\n\n## Follow-up\nNotes three');
    await editor.getByRole('button', { name: 'Save note', exact: true }).click();
    await expect(editor).toHaveCount(0);
    const card = page.locator('.journal-card').filter({ hasText: 'Notes three' });
    const sections = card.locator('.markdown-section-heading button');
    await expect(sections).toHaveCount(3);
    const pill = card.getByRole('group', { name: /^Sections for / });
    const expand = pill.getByRole('button', { name: 'Expand all sections', exact: true });
    const collapse = pill.getByRole('button', { name: 'Collapse all sections', exact: true });
    // Daily note sections start collapsed.
    await expect(collapse).toHaveAttribute('aria-pressed', 'true');
    for (const section of await sections.all()) await expect(section).toHaveAttribute('aria-expanded', 'false');
    await expect(card.getByText('Notes two', { exact: true })).toBeHidden();
    // The pill sits just left of the section label.
    const pillBox = await pill.boundingBox();
    const labelBox = await card.locator('.journal-card-head > .card-label').first().boundingBox();
    if (!pillBox || !labelBox) throw new Error('Pill or label is missing.');
    expect(labelBox.x - (pillBox.x + pillBox.width)).toBeLessThanOrEqual(12);
    await expand.click();
    await expect(expand).toHaveAttribute('aria-pressed', 'true');
    for (const section of await sections.all()) await expect(section).toHaveAttribute('aria-expanded', 'true');
    await expect(card.getByText('Notes two', { exact: true })).toBeVisible();
    await collapse.click();
    for (const section of await sections.all()) await expect(section).toHaveAttribute('aria-expanded', 'false');
    // A single section still opens on its own.
    await sections.nth(1).click();
    await expect(card.getByText('Notes two', { exact: true })).toBeVisible();
    await expect(sections.nth(0)).toHaveAttribute('aria-expanded', 'false');
});

test('journal notes preview Markdown safely and preserve edits when saved', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/notes');
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const body = dialog.locator('textarea[name="body"]');
    const markdown = [
        'A **bold** note.',
        '',
        '- first item',
        '- second item',
        '',
        '[Safe](https://example.com)',
        '[bad](javascript:alert(1))',
        '[data](data:text/html,hi)',
        '',
        '<script>alert(1)</script>',
        '',
        '## First section',
        '[Cross-section][reference]',
        '',
        '## Second section',
        '',
        '## Code sample',
        '```md',
        '## not a section',
        '```',
        '',
        '[reference]: https://example.com/reference',
    ].join('\n');

    await body.fill(markdown);
    await dialog.getByRole('button', { name: 'Preview' }).click();
    const preview = dialog.locator('.markdown-editor-preview');
    await expect(preview.getByText('bold', { exact: true })).toBeVisible();
    await expect(preview.locator('ul li')).toHaveCount(2);
    await expect(preview.getByRole('link', { name: 'Safe' })).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(preview.getByRole('link', { name: 'Cross-section' })).toHaveAttribute(
        'href',
        'https://example.com/reference'
    );
    await expect(preview.getByRole('link', { name: 'bad' })).toHaveCount(0);
    await expect(preview.getByRole('link', { name: 'data' })).toHaveCount(0);
    await expect(preview).toContainText('<script>alert(1)</script>');
    await expect(preview.locator('script')).toHaveCount(0);
    await expect(preview.getByRole('button', { name: 'First section' })).toHaveCount(1);
    await expect(preview.getByRole('button', { name: 'Second section' })).toHaveCount(1);
    await expect(preview.getByRole('button', { name: 'Code sample' })).toHaveCount(1);
    await expect(preview.getByRole('button', { name: 'not a section' })).toHaveCount(0);

    const firstSection = preview.getByRole('button', { name: 'First section', exact: true });
    await firstSection.press('Enter');
    await expect(firstSection).toHaveAttribute('aria-expanded', 'false');
    await expect(preview.getByRole('link', { name: 'Cross-section' })).toBeHidden();
    await firstSection.press('Space');
    await expect(preview.getByRole('link', { name: 'Cross-section' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(body).toHaveValue(markdown);
    await dialog.getByRole('button', { name: 'Save note' }).click();
    await expect(dialog).toBeHidden();
    // Saved daily notes start with their sections collapsed.
    const savedSection = page
        .locator('.journal-card')
        .filter({ hasText: 'Cross-section' })
        .getByRole('button', { name: 'First section', exact: true });
    await expect(savedSection).toHaveAttribute('aria-expanded', 'false');
    await savedSection.click();
    await expect(page.getByRole('link', { name: 'Cross-section' })).toHaveAttribute(
        'href',
        'https://example.com/reference'
    );
});

for (const { theme, width } of [
    { theme: 'midnight', width: 1280 },
    { theme: 'light', width: 390 },
]) {
    test(`Markdown lists retain markers in note previews and saved notes in ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('the-workbench.theme-preference', value), theme);
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/notes');
        await page.addStyleTag({ content: 'ul, ol, li { list-style: none; } li::marker { content: ""; }' });

        const markdown = [
            'Questions:',
            '- First item',
            '  - Nested item',
            '    - Deep item',
            '- Second item',
            '',
            '3. Third item',
            '4. Fourth item',
        ].join('\n');
        const title = `List markers ${theme}`;
        await openEditor(page, 'Global note');
        let dialog = page.getByRole('dialog');
        await dialog.locator('input[name="title"]').fill(title);
        await dialog.locator('textarea[name="body"]').fill(markdown);
        await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
        await expectMarkdownListMarkers(dialog.locator('.markdown-editor-preview'));
        await dialog.getByRole('button', { name: 'Save note' }).click();
        await expect(dialog).toBeHidden();
        await page
            .getByRole('group', { name: 'Filter notes', exact: true })
            .getByRole('button', { name: 'Global', exact: true })
            .click();
        await expectMarkdownListMarkers(page.locator('.global-note-card').filter({ hasText: title }));
        await page
            .getByRole('group', { name: 'Filter notes', exact: true })
            .getByRole('button', { name: 'Work', exact: true })
            .click();

        await page.getByRole('button', { name: 'New note', exact: true }).click();
        dialog = page.getByRole('dialog');
        await dialog.locator('input[name="title"]').fill(title);
        await dialog.locator('textarea[name="body"]').fill(markdown);
        await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
        await expectMarkdownListMarkers(dialog.locator('.markdown-editor-preview'));
        await dialog.getByRole('button', { name: 'Save note' }).click();
        await expect(dialog).toBeHidden();
        await expectMarkdownListMarkers(page.locator('.journal-card').filter({ hasText: title }));
    });
}

test('note editor keeps its existing phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/notes');
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const box = await page.getByRole('dialog').boundingBox();
    expect(box?.width).toBeCloseTo(358, 0);
});

test('Add section inserts a heading at the editor cursor', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/notes');
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const body = dialog.locator('textarea[name="body"]');
    await body.fill('Before after');
    await body.evaluate((textarea: HTMLTextAreaElement) => textarea.setSelectionRange(7, 7));
    await dialog.getByRole('button', { name: 'Add section' }).click();
    await expect(body).toHaveValue('Before \n## Section title\nafter');
    await dialog.getByRole('button', { name: 'Preview' }).click();
    await expect(dialog.getByRole('button', { name: 'Section title' })).toHaveAttribute('aria-expanded', 'true');
});

test('Markdown syntax help supports hover, keyboard and outside dismissal', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('the-workbench.theme-preference', 'midnight'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/notes');
    await expect(page.locator('html')).toHaveClass(/theme-midnight/);
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const help = dialog.getByRole('button', { name: 'Markdown syntax help' });
    const tooltip = dialog.locator('.markdown-help');
    const body = dialog.locator('textarea[name="body"]');
    const initialHelpPosition = await help.boundingBox();
    const initialBodyPosition = await body.boundingBox();

    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await expect(help).toHaveAccessibleDescription(/Divider/);
    await dialog.locator('.markdown-editor-label .field-label').hover();
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await help.hover();
    await expect(tooltip).toBeVisible();
    expect(await help.boundingBox()).toEqual(initialHelpPosition);
    expect(await body.boundingBox()).toEqual(initialBodyPosition);
    await expect(tooltip.getByText('---', { exact: true })).toBeVisible();
    await expect(tooltip.getByText('## Section', { exact: true })).toBeVisible();
    await tooltip.hover();
    await expect(tooltip).toBeVisible();
    await page.mouse.move(1, 1);
    await expect(tooltip).toBeHidden();

    await help.focus();
    await expect(tooltip).toBeVisible();
    await help.press('Escape');
    await expect(tooltip).toBeHidden();
    await expect(dialog).toBeVisible();
    await body.focus();
    await help.focus();
    await page.keyboard.press('Tab');
    await expect(tooltip).toBeHidden();

    await body.fill('Draft remains');
    await help.click();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await body.click();
    await expect(tooltip).toBeHidden();
    await expect(body).toHaveValue('Draft remains');
    await expect(dialog.locator('[title]')).toHaveCount(0);
});

test.describe('Markdown syntax help on touch', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

    test('opens in global notes and fits the phone viewport in light mode', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('the-workbench.theme-preference', 'light'));
        await page.goto('/notes');
        await expect(page.locator('html')).toHaveClass(/light/);
        await openEditor(page, 'Global note', 'tap');
        const dialog = page.getByRole('dialog', { name: 'New note', exact: true });
        const help = dialog.getByRole('button', { name: 'Markdown syntax help' });
        // A late font swap changes the label width, so measure after fonts settle.
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.waitForTimeout(300);
        const initialHelpPosition = await help.boundingBox();
        await help.tap();
        const tooltip = dialog.getByRole('tooltip');
        await expect(tooltip).toBeVisible();
        expect(await help.boundingBox()).toEqual(initialHelpPosition);
        await expect(tooltip.getByText('---', { exact: true })).toBeVisible();
        const box = await tooltip.boundingBox();
        if (!box) throw new Error('Markdown syntax help is not visible.');
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(844);
        expect(
            await tooltip.evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                const hit = document.elementFromPoint(bounds.left + 5, bounds.bottom - 5);
                return hit !== null && element.contains(hit);
            })
        ).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(
            0
        );
        await help.tap();
        await expect(help).toHaveAttribute('aria-expanded', 'false');
        await help.tap();
        await expect(help).toHaveAttribute('aria-expanded', 'true');
        await dialog.locator('input[name="title"]').tap();
        await expect(tooltip).toBeHidden();
        await expect(dialog).toBeVisible();
    });
});

test('global notes can be searched and reopened without pin controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/notes');
    const title = `Global ${Date.now()}`;
    await openEditor(page, 'Global note');
    const dialog = page.getByRole('dialog', { name: 'New note', exact: true });
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('textarea[name="body"]').fill('Reference for later');
    await dialog.locator('input[name="tags"]').fill('reference');
    await dialog.getByRole('button', { name: 'Save note' }).click();
    await page
        .getByRole('group', { name: 'Filter notes', exact: true })
        .getByRole('button', { name: 'Global', exact: true })
        .click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByRole('button', { name: `Pin ${title}` })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Unpin ${title}` })).toHaveCount(0);

    await page.getByRole('searchbox', { name: 'Search notes' }).fill(title);
    await expect(page.getByText('Reference for later')).toBeVisible();
    await page.reload();
    await page
        .getByRole('group', { name: 'Filter notes', exact: true })
        .getByRole('button', { name: 'Global', exact: true })
        .click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.getByRole('button', { name: `Edit ${title}` }).click();
    await expect(page.getByRole('dialog').locator('textarea[name="body"]')).toHaveValue('Reference for later');
    await closeDialog(page.getByRole('dialog'));
    await expect(page.getByRole('button', { name: `Pin ${title}` })).toHaveCount(0);
});

test('global note editor previews Markdown and submits its hidden textarea value', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/notes');
    await openEditor(page, 'Global note');
    const dialog = page.getByRole('dialog', { name: 'New note', exact: true });
    const body = dialog.locator('textarea[name="body"]');
    await dialog.locator('input[name="title"]').fill('Markdown global note');
    await body.fill('A **global** note.');
    await dialog.getByRole('button', { name: 'Preview' }).click();
    await expect(dialog.locator('.markdown-editor-preview').getByText('global', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(body).toHaveValue('A **global** note.');
    await dialog.getByRole('button', { name: 'Save note' }).click();
    await expect(dialog).toBeHidden();

    await page
        .getByRole('group', { name: 'Filter notes', exact: true })
        .getByRole('button', { name: 'Global', exact: true })
        .click();
    const card = page.locator('.global-note-card').filter({ hasText: 'Markdown global note' });
    await expect(card.locator('strong')).toHaveText('global');
    await page.setViewportSize({ width: 1280, height: 900 });
    await card.getByRole('button', { name: 'Edit Markdown global note' }).click();
    const editDialog = page.getByRole('dialog');
    expect((await editDialog.boundingBox())?.height).toBeCloseTo(828, 0);
    await expect(editDialog.locator('textarea[name="body"]')).toHaveValue('A **global** note.');
});

test('modal opening fades without moving the page and calendar swaps keep the backdrop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/notes');
    await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Filter notes', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Synced');
    await page.evaluate(async () => {
        await Promise.all(
            document
                .getAnimations()
                .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
                // A cancelled animation (element re-rendered mid-fade) rejects; it is finished for this purpose.
                .map((animation) => animation.finished.catch(() => undefined))
        );
    });
    const frames = await page.evaluate(async () => {
        document.body.style.minHeight = '2000px';
        window.scrollTo(0, 600);
        const scrollBefore = window.scrollY;
        const opener = document.querySelector<HTMLButtonElement>('button[aria-label="New note"]');
        if (!opener) throw new Error('Entry opener is missing.');
        opener.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
        if (!dialog) throw new Error('Entry dialog did not open.');
        const samples: { opacity: number; top: number }[] = [];
        const started = performance.now();
        do {
            samples.push({
                opacity: Number(getComputedStyle(dialog).opacity),
                top: dialog.getBoundingClientRect().top,
            });
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        } while (performance.now() - started < 350);
        return { samples, scrollBefore, scrollAfter: window.scrollY };
    });
    expect(frames.samples[0].opacity).toBeLessThan(0.8);
    expect(frames.samples.at(-1)?.opacity).toBe(1);
    expect(frames.samples.some((sample) => sample.opacity > 0 && sample.opacity < 1)).toBe(true);
    expect(
        Math.max(...frames.samples.map((sample) => sample.top)) -
            Math.min(...frames.samples.map((sample) => sample.top))
    ).toBeLessThanOrEqual(1);
    expect(frames.scrollAfter).toBe(frames.scrollBefore);
    await closeDialog(page.getByRole('dialog'));
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await page.getByRole('dialog').locator('.calendar-day[data-has-entry="false"]').first().click();
    const entry = page.getByRole('dialog');
    await expect(entry).toHaveAttribute('data-replacing', 'true');
    expect(await entry.evaluate((element) => getComputedStyle(element, '::backdrop').animationName)).toBe('none');
    await closeDialog(entry);
});

for (const { theme, width } of [
    { theme: 'midnight', width: 1280 },
    { theme: 'light', width: 390 },
]) {
    test(`weekly groups and the global group collapse independently in ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('the-workbench.theme-preference', value), theme);
        await page.setViewportSize({ width, height: 844 });
        await page.goto('/notes');

        const now = new Date();
        const previous = new Date(now);
        previous.setDate(previous.getDate() - 7);
        const dateKey = (date: Date) =>
            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const editedLabel = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const recentBody = `Recent group ${theme} ${Date.now()}`;
        const olderBody = `Older group ${theme} ${Date.now()}`;
        const globalTitle = `Legacy global ${theme} ${Date.now()}`;
        await page.evaluate(
            async ({ today, oldDay, recentBody, olderBody, globalTitle, updatedAt, editedLabel }) => {
                const changes = [
                    {
                        path: '/api/journal/mutations',
                        value: { id: crypto.randomUUID(), entryDate: today, body: recentBody },
                    },
                    {
                        path: '/api/journal/mutations',
                        value: { id: crypto.randomUUID(), entryDate: oldDay, body: olderBody },
                    },
                    {
                        path: '/api/global-notes/mutations',
                        value: {
                            id: crypto.randomUUID(),
                            title: globalTitle,
                            body: 'Legacy global body',
                            pinned: true,
                        },
                    },
                ];
                for (const change of changes) {
                    const response = await fetch(change.path, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            kind: 'save',
                            mutationId: crypto.randomUUID(),
                            baseVersion: 0,
                            tags: [],
                            updatedAt,
                            editedLabel,
                            ...change.value,
                        }),
                    });
                    if (!response.ok) throw new Error(`Fixture save failed with HTTP ${response.status}.`);
                }
            },
            {
                today: dateKey(now),
                oldDay: dateKey(previous),
                recentBody,
                olderBody,
                globalTitle,
                updatedAt: now.toISOString(),
                editedLabel,
            }
        );
        await page.reload();
        const filter = page.getByRole('group', { name: 'Filter notes', exact: true });
        // Daily notes saved before categories were required show under Home.
        await filter.getByRole('button', { name: 'Home', exact: true }).click();

        const globalGroup = page.getByRole('region', { name: 'Global notes', exact: true });
        const globalCard = globalGroup.locator('article').filter({ hasText: globalTitle });
        const recentCard = page.locator('article.journal-card').filter({ hasText: recentBody });
        const olderCard = page.locator('article.journal-card').filter({ hasText: olderBody });
        const recentGroup = page.locator('section.journal-week').filter({ has: recentCard });
        const olderGroup = page.locator('section.journal-week').filter({ has: olderCard });
        const globalToggle = globalGroup.getByRole('button', { name: 'Global notes', exact: true });
        const recentToggle = recentGroup.getByRole('button', { name: /^Week of / });
        const olderToggle = olderGroup.getByRole('button', { name: /^Week of / });

        await expect(recentCard).toBeVisible();
        await expect(olderCard).toBeHidden();
        await expect(recentToggle).toHaveAttribute('aria-expanded', 'true');
        await expect(olderToggle).toHaveAttribute('aria-expanded', 'false');
        await olderToggle.click();
        await expect(olderCard).toBeVisible();
        const recentDayToggle = recentCard.locator('.journal-day-toggle');
        const olderDayToggle = olderCard.locator('.journal-day-toggle');
        await expect(recentDayToggle).toHaveAttribute('aria-expanded', 'true');
        await expect(olderDayToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(recentCard.locator('.journal-body')).toBeVisible();
        await expect(olderCard.locator('.journal-body')).toBeHidden();
        await expect(olderCard.getByRole('button', { name: /^Edit / })).toBeHidden();
        await olderDayToggle.press('Enter');
        await expect(olderCard.locator('.journal-body')).toBeVisible();
        await expect(olderCard.getByRole('button', { name: /^Edit / })).toBeVisible();
        await recentDayToggle.press('Space');
        await expect(recentCard.locator('.journal-body')).toBeHidden();
        await expect(olderCard.locator('.journal-body')).toBeVisible();
        await recentDayToggle.click();
        await expect(recentCard.locator('.journal-body')).toBeVisible();
        await expect(recentCard).toBeVisible();

        await recentToggle.press('Space');
        await olderToggle.click();
        await expect(recentToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(olderToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(recentCard).toBeHidden();
        await expect(olderCard).toBeHidden();
        await expect(recentCard).toBeHidden();
        await recentToggle.press('Enter');
        await olderToggle.press('Space');
        await expect(recentCard).toBeVisible();
        await expect(olderCard).toBeVisible();
        await expect(recentDayToggle).toHaveAttribute('aria-expanded', 'true');
        await expect(olderDayToggle).toHaveAttribute('aria-expanded', 'true');
        // Global notes have their own filter, where the group starts open and still collapses.
        await filter.getByRole('button', { name: 'Global', exact: true }).click();
        await expect(recentCard).toHaveCount(0);
        await expect(globalToggle).toHaveAttribute('aria-expanded', 'true');
        await expect(globalCard).toBeVisible();
        await expect(globalGroup.getByRole('button', { name: /^(Pin|Unpin) / })).toHaveCount(0);
        await globalToggle.press('Enter');
        await expect(globalCard).toBeHidden();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
}

test('section commentary opens from a rail in each section, and from one rail on a note without sections', async ({
    page,
    context,
}) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/notes');
    const stamp = Date.now();
    const prep = `Interview prep ${stamp}`;
    const plainTitle = `Plain note ${stamp}`;
    const dialog = page.getByRole('dialog');
    const create = async (title: string, body: string) => {
        await page.getByRole('button', { name: 'New note', exact: true }).click();
        await dialog.locator('input[name="title"]').fill(title);
        await dialog.locator('textarea[name="body"]').fill(body);
        await dialog.getByRole('button', { name: 'Save note', exact: true }).click();
        await expect(dialog).toHaveCount(0);
    };
    await create(prep, '## My qualifications\nCareer summary\n\n## Questions\nWhat is next?');
    await create(plainTitle, 'No sections in this one');

    const card = page.locator('.journal-card').filter({ hasText: prep });
    await card.getByRole('button', { name: 'Expand all sections', exact: true }).click();
    const rail = card.getByRole('button', { name: 'Add commentary for Questions', exact: true });
    await expect(card.getByRole('button', { name: /commentary for/i })).toHaveCount(2);
    // In a section, the rail sits in the heading row just left of the section's arrow.
    const heading = card.getByRole('button', { name: 'Questions', exact: true });
    const [railBox, headingBox, arrowBox] = await Promise.all([
        rail.boundingBox(),
        heading.boundingBox(),
        heading.locator('svg').boundingBox(),
    ]);
    if (!railBox || !headingBox || !arrowBox) throw new Error('Rail or heading is missing.');
    expect(railBox.x + railBox.width).toBeLessThanOrEqual(arrowBox.x);
    expect(arrowBox.x - (railBox.x + railBox.width)).toBeLessThanOrEqual(10);
    expect(Math.abs(railBox.y + railBox.height / 2 - (arrowBox.y + arrowBox.height / 2))).toBeLessThanOrEqual(3);
    // A note without sections keeps its rail at the content's upper right.
    const plainCard = page.locator('.journal-card').filter({ hasText: plainTitle });
    const plainRail = await plainCard
        .getByRole('button', { name: `Add commentary for ${plainTitle}`, exact: true })
        .boundingBox();
    const plainBody = await plainCard.locator('.commentary-layout').boundingBox();
    expect(plainBody!.x + plainBody!.width - (plainRail!.x + plainRail!.width)).toBeLessThanOrEqual(1);

    await rail.click();
    const pane = card.getByRole('complementary', { name: 'Commentary for Questions', exact: true });
    const input = pane.getByRole('textbox', { name: 'Commentary for Questions', exact: true });
    await expect(input).toBeFocused();
    await input.fill('Ask about **reporting** first');
    await pane.getByRole('button', { name: 'View commentary', exact: true }).click();
    await expect(pane.locator('strong')).toHaveText('reporting');
    await expect(pane.getByRole('button', { name: 'Edit commentary', exact: true })).toBeVisible();
    const paneBox = await pane.boundingBox();
    if (!paneBox) throw new Error('Pane is missing.');
    // Open on desktop: the arrow stays at the right, the pane sits just left of it with its top level with the
    // heading, and the bar runs down the pane's left edge.
    const [openArrow, openRailNow, openHeading] = await Promise.all([
        heading.locator('svg').boundingBox(),
        card.getByRole('button', { name: 'Commentary for Questions', exact: true }).boundingBox(),
        heading.boundingBox(),
    ]);
    expect(Math.abs(openArrow!.x - arrowBox.x)).toBeLessThanOrEqual(1);
    expect(paneBox.x + paneBox.width).toBeLessThanOrEqual(openArrow!.x);
    expect(Math.abs(paneBox.y - openHeading!.y)).toBeLessThanOrEqual(2);
    expect(openRailNow!.x + openRailNow!.width).toBeLessThanOrEqual(paneBox.x + 1);
    expect(paneBox.x - (openRailNow!.x + openRailNow!.width)).toBeLessThanOrEqual(2);
    await expect(pane).toHaveCSS('scrollbar-width', 'thin');

    // Dragging the rail sets the pane width.
    const openRail = card.getByRole('button', { name: 'Commentary for Questions', exact: true });
    const handle = await openRail.boundingBox();
    if (!handle) throw new Error('Rail is missing.');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 10);
    await page.mouse.down();
    await page.mouse.move(handle.x - 120, handle.y + 10, { steps: 6 });
    await page.mouse.up();
    expect((await pane.boundingBox())!.width).toBeGreaterThan(paneBox.width + 80);
    await expect(pane).toBeVisible();

    const plain = page.locator('.journal-card').filter({ hasText: plainTitle });
    await plain.getByRole('button', { name: `Add commentary for ${plainTitle}`, exact: true }).click();
    const plainInput = plain.getByRole('textbox', { name: `Commentary for ${plainTitle}`, exact: true });
    await context.setOffline(true);
    await plainInput.fill('Written offline');
    await plainInput.press('Escape');
    await expect(plain.getByRole('complementary').getByText('Written offline')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole('status').first()).toHaveText('Synced', { timeout: 45_000 });

    await page.reload();
    const reloaded = page.locator('.journal-card').filter({ hasText: prep });
    await reloaded.getByRole('button', { name: 'Expand all sections', exact: true }).click();
    await reloaded.getByRole('button', { name: 'Commentary for Questions', exact: true }).click();
    await expect(reloaded.getByRole('complementary').locator('strong')).toHaveText('reporting');
    // Emptying commentary deletes it.
    await reloaded.getByRole('button', { name: 'Edit commentary', exact: true }).click();
    await reloaded.getByRole('textbox', { name: 'Commentary for Questions', exact: true }).fill('');
    await reloaded.getByRole('button', { name: 'View commentary', exact: true }).click();
    await expect(reloaded.getByText('No commentary yet.')).toBeVisible();
    await expect(page.getByRole('status').first()).toHaveText('Synced');
    const { comments } = await (await page.request.get('/api/journal/comments')).json();
    expect(comments.map((comment: { body: string }) => comment.body)).toContain('Written offline');
    expect(comments.map((comment: { body: string }) => comment.body)).not.toContain('Ask about **reporting** first');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
        .toBeLessThanOrEqual(0);
});
