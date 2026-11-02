import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const favicon = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const touchIcon = readFileSync(new URL('../public/apple-touch-icon.svg', import.meta.url), 'utf8');
const touchPng = readFileSync(new URL('../public/apple-touch-icon.png', import.meta.url));

function artwork(svg: string) {
    const start = svg.indexOf('<circle ');
    const end = svg.lastIndexOf('</svg>');
    if (start < 0 || end <= start) throw new Error('Icon artwork is missing.');
    return svg.slice(start, end).trim();
}

describe('The Workbench icons', () => {
    it('uses the same bulb artwork for the favicon and installed icon', () => {
        expect(artwork(touchIcon)).toBe(artwork(favicon));
        expect(artwork(favicon)).toContain('fill="#fbbf24"');
        expect(artwork(favicon)).toContain('stroke="#fb923c"');
        expect(artwork(favicon)).toContain('fill="#6b8cae"');
    });

    it('uses a full-bleed background for the iOS source', () => {
        expect(touchIcon).toContain('<rect width="64" height="64" fill="#0f172a" />');
    });

    it('ships a 180 by 180 PNG for iOS', () => {
        expect(touchPng.subarray(0, 8)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
        expect(touchPng.readUInt32BE(16)).toBe(180);
        expect(touchPng.readUInt32BE(20)).toBe(180);
    });
});
