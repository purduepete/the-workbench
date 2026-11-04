export function oneDriveImageUrl(value: string): string | null {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase();
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        !(
            host === '1drv.ms' ||
            host === 'onedrive.live.com' ||
            host === 'photos.onedrive.com' ||
            host.endsWith('.sharepoint.com')
        )
    )
        return null;
    return url.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

export function imageLinkMarkdown(label: string, url: string): string {
    return `[${(label.trim() || 'Image').replace(/[\\[\]*_`~<>]/g, '\\$&')}](${url})`;
}

export function splitImageLinks(body: string) {
    const links: { label: string; url: string }[] = [];
    const text = body.replace(
        /\[((?:\\.|[^\]\\\n])+)\]\((https:\/\/[^\s)]+)\)/g,
        (match, label: string, href: string) => {
            const url = oneDriveImageUrl(href);
            if (!url) return match;
            links.push({ label: label.replace(/\\([\\[\]*_`~<>])/g, '$1'), url });
            return '';
        }
    );
    return { text: links.length ? text.trim() : body, links };
}
