import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getOneDriveSession, prepareOneDrive, subscribeOneDriveSession } from './oneDrivePicker';
import type { OneDriveSession } from './oneDrivePicker';
import { oneDriveImageUrl } from './oneDriveLinks';
import { z } from 'zod';

export function thumbnailEndpoint(href: string, session: OneDriveSession): string {
    const safe = oneDriveImageUrl(href);
    if (!safe) throw new Error('Unsupported OneDrive image link.');
    const url = new URL(safe);
    const personal = session.config.tenantId === 'consumers';
    const base = personal ? 'https://api.onedrive.com/v1.0' : `${new URL(session.config.baseUrl).origin}/_api/v2.0`;
    const id =
        personal && url.hostname === 'onedrive.live.com'
            ? (url.searchParams.get('resid') ?? url.searchParams.get('id'))
            : null;
    if (id) return `${base}/drive/items/${encodeURIComponent(id)}/thumbnails`;
    const bytes = new TextEncoder().encode(safe);
    const encoded = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return `${base}/shares/u!${encoded}/root/thumbnails`;
}

export function safeThumbnailUrl(value: string): string {
    const url = new URL(value);
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        ![
            '.files.1drv.com',
            '.files.1drvusercontent.com',
            '.storage.live.com',
            '.sharepoint.com',
            '-medias.svc.ms',
        ].some((suffix) => url.hostname.endsWith(suffix))
    )
        throw new Error('OneDrive returned an unsupported thumbnail host.');
    return url.href;
}

const thumbnailsSchema = z.object({
    value: z.array(
        z.object({
            small: z.object({ url: z.string() }).optional(),
            medium: z.object({ url: z.string() }).optional(),
        })
    ),
});

export function OneDriveThumbnail({ href, label }: { href: string; label: string }) {
    const session = useSyncExternalStore(subscribeOneDriveSession, getOneDriveSession);
    const [prepared, setPrepared] = useState<OneDriveSession | null>(null);
    const [src, setSrc] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), []);
    useEffect(() => {
        let current = true;
        if (!session) {
            void prepareOneDrive().then(
                (value) => {
                    if (current) setPrepared(value);
                },
                (error: unknown) => {
                    if (current) setError(error instanceof Error ? error.message : 'OneDrive setup unavailable.');
                }
            );
            return () => {
                current = false;
            };
        }
        const abort = new AbortController();
        void (async () => {
            try {
                const token = await session.token();
                if (!navigator.onLine) throw new Error('Offline. Open the image when connected.');
                const response = await fetch(thumbnailEndpoint(href, session), {
                    headers: { Authorization: `Bearer ${token}` },
                    credentials: 'omit',
                    redirect: 'error',
                    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
                });
                if (!response.ok)
                    throw new Error(`Thumbnail unavailable (HTTP ${response.status}). Sign in to OneDrive again.`);
                const data = thumbnailsSchema.parse(await response.json());
                const thumbnail = data.value[0]?.medium ?? data.value[0]?.small;
                if (!thumbnail) throw new Error('OneDrive has no thumbnail for this image.');
                const url = safeThumbnailUrl(thumbnail.url);
                if (current) {
                    setSrc(url);
                    setError('');
                }
            } catch (error) {
                if (current) {
                    setSrc('');
                    setError(error instanceof Error ? error.message : 'Thumbnail unavailable.');
                }
            }
        })();
        return () => {
            current = false;
            abort.abort();
        };
    }, [href, session]);

    return (
        <span className="image-thumbnail">
            <a href={href} aria-label={label} target="_blank" rel="noopener noreferrer">
                {src && (
                    <img
                        src={src}
                        alt={label}
                        width={120}
                        height={90}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={() => {
                            setSrc('');
                            setError('Thumbnail could not load. Open the image in OneDrive.');
                        }}
                    />
                )}
                <span>{label}</span>
            </a>
            {!src && prepared && (
                <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                        const abort = new AbortController();
                        controller.current = abort;
                        setBusy(true);
                        void prepared
                            .signIn(abort.signal)
                            .catch((error: unknown) => {
                                if (!abort.signal.aborted)
                                    setError(error instanceof Error ? error.message : 'Microsoft sign-in failed.');
                            })
                            .finally(() => {
                                if (!abort.signal.aborted) setBusy(false);
                            });
                    }}
                >
                    Sign in for thumbnail
                </button>
            )}
            {!session && !error && <span className="field-hint">Sign in to OneDrive to view the thumbnail.</span>}
            {error && (
                <span className="field-hint" role="status">
                    {error}
                </span>
            )}
        </span>
    );
}
