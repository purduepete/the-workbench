import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('loading and entrance styles', () => {
    it('fades cards in place without sliding them', () => {
        const fadeUp = css.slice(css.indexOf('@keyframes fade-up'));
        expect(fadeUp.slice(0, fadeUp.indexOf('\n}'))).not.toContain('transform');
    });

    it('fades dialogs and their backdrop in when they open', () => {
        expect(css).toMatch(
            /\.dialog-backdrop\[open\],\s*\.dialog-backdrop\[open\]::backdrop\s*\{\s*animation: dialog-open/
        );
    });
});
