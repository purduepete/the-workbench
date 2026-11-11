import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { DialogCloseButton } from './DialogClose';
import { useDelayedLoading } from './Loading';
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

const thumbnailSchema = z.object({ url: z.string(), width: z.number().optional(), height: z.number().optional() });
const thumbnailsSchema = z.object({ value: z.array(z.record(z.string(), z.unknown())) });
const imageFacetSchema = z.object({
    image: z.object({ width: z.number().optional(), height: z.number().optional() }).optional(),
});

export interface OneDriveImage {
    url: string;
    width?: number;
    height?: number;
}

async function oneDriveGet(url: string, session: OneDriveSession, signal: AbortSignal): Promise<unknown> {
    const token = await session.token();
    if (!navigator.onLine) throw new Error('Offline. Open the image when connected.');
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) throw new Error(`Thumbnail unavailable (HTTP ${response.status}). Sign in to OneDrive again.`);
    return response.json();
}

/** Fetches a short-lived OneDrive thumbnail; sizes are tried in order (for example `c2560x2560`, `large`). */
export async function fetchThumbnail(
    href: string,
    session: OneDriveSession,
    sizes: string[],
    signal: AbortSignal
): Promise<OneDriveImage> {
    const custom = sizes.find((size) => /^c\d+x\d+$/.test(size));
    const endpoint = thumbnailEndpoint(href, session);
    const set =
        thumbnailsSchema.parse(await oneDriveGet(custom ? `${endpoint}?select=${custom}` : endpoint, session, signal))
            .value[0] ?? {};
    for (const size of sizes) {
        const parsed = thumbnailSchema.safeParse(set[size]);
        if (parsed.success) return { ...parsed.data, url: safeThumbnailUrl(parsed.data.url) };
    }
    throw new Error('OneDrive has no thumbnail for this image.');
}

/** The viewer's image: up to 2560px on the long side, with the size it will be shown at, never above the original. */
export async function fetchFullImage(
    href: string,
    session: OneDriveSession,
    signal: AbortSignal
): Promise<OneDriveImage> {
    const endpoint = thumbnailEndpoint(href, session).replace(/\/thumbnails$/, '');
    const original = oneDriveGet(`${endpoint}?select=image`, session, signal).then(
        (value) => imageFacetSchema.parse(value).image ?? null,
        () => null
    );
    let image: OneDriveImage;
    try {
        image = await fetchThumbnail(href, session, ['c2560x2560'], signal);
    } catch (error) {
        if (signal.aborted) throw error;
        image = await fetchThumbnail(href, session, ['large', 'medium'], signal);
    }
    const facet = await original;
    // The served copy can be scaled up from a small original, so the smaller known size wins.
    const known = [image, facet].filter((size): size is { width: number; height: number } =>
        Boolean(size?.width && size.height)
    );
    const smallest = known.sort((a, b) => a.width - b.width)[0];
    return smallest ? { url: image.url, width: smallest.width, height: smallest.height } : { url: image.url };
}
function ImageViewer({
    href,
    label,
    ratio,
    image,
    failure,
    onClose,
}: {
    href: string;
    label: string;
    ratio: number;
    image?: OneDriveImage;
    failure?: string;
    onClose: () => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [full, setFull] = useState('');
    const [error, setError] = useState(failure ?? '');

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const topbar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
        dialog?.style.setProperty('--viewer-top', `${Math.max(0, Math.round(topbar)) + 10}px`);
        if (dialog && !dialog.open) dialog.showModal();
        dialog?.focus({ preventScroll: true });
        return () => {
            if (dialog?.open) dialog.close();
            if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        };
    }, []);

    useEffect(() => {
        if (!image) return;
        let current = true;
        // Download and decode before showing, so the viewer never shows a partial or low-resolution image.
        const loader = new Image();
        loader.referrerPolicy = 'no-referrer';
        loader.src = image.url;
        loader.decode().then(
            () => {
                if (current) setFull(image.url);
            },
            () => {
                if (current) setError('The full image could not load.');
            }
        );
        return () => {
            current = false;
        };
    }, [image]);
    const showSpinner = useDelayedLoading(!full && !error);
    const frameStyle = {
        '--image-ratio': image?.width && image.height ? image.width / image.height : ratio,
        ...(image?.width ? { '--image-width': `${image.width}px` } : {}),
    } as CSSProperties;

    return createPortal(
        <dialog
            ref={dialogRef}
            className="dialog-backdrop image-viewer"
            aria-label={label}
            tabIndex={-1}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key !== 'Escape') return;
                event.preventDefault();
                onClose();
            }}
            onClick={(event) => {
                // Clicks stay inside the viewer so cards and editors behind it do not react.
                event.stopPropagation();
                if (event.target === dialogRef.current || event.target === event.currentTarget.firstChild) onClose();
            }}
        >
            <div className="image-viewer-stage">
                <div className="dialog-corner-actions">
                    <DialogCloseButton onClose={onClose} />
                </div>
                {/* The frame has the image's final size from the start: its shape, and never above the original. */}
                <div className="image-viewer-frame" style={frameStyle}>
                    {full ? (
                        <img src={full} alt={label} referrerPolicy="no-referrer" />
                    ) : (
                        !error &&
                        showSpinner && (
                            <div className="spinner-wrap" role="status">
                                <span className="spinner" aria-hidden="true" />
                                <span className="sr-only">Loading {label}</span>
                            </div>
                        )
                    )}
                </div>
                {error && (
                    <p className="image-viewer-error" role="status">
                        {error}{' '}
                        <a href={href} target="_blank" rel="noopener noreferrer">
                            Open in OneDrive
                        </a>
                    </p>
                )}
            </div>
        </dialog>,
        document.body
    );
}

export function OneDriveThumbnail({ href, label }: { href: string; label: string }) {
    const session = useSyncExternalStore(subscribeOneDriveSession, getOneDriveSession);
    const [prepared, setPrepared] = useState<OneDriveSession | null>(null);
    const [src, setSrc] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [viewing, setViewing] = useState<{ ratio: number; image?: OneDriveImage; failure?: string } | null>(null);
    const controller = useRef<AbortController | null>(null);
    const fullImage = useRef<{ href: string; at: number; promise: Promise<OneDriveImage> } | null>(null);
    useEffect(() => () => controller.current?.abort(), []);
    // Starts fetching the full image's address and size on hover, focus or touch, so a click opens at once.
    const prefetchFullImage = () => {
        if (!session || !src) return null;
        const cached = fullImage.current;
        // OneDrive image addresses are temporary, so a cached one is reused only briefly.
        if (cached && cached.href === href && Date.now() - cached.at < 5 * 60_000) return cached.promise;
        const promise = fetchFullImage(href, session, new AbortController().signal);
        promise.catch(() => undefined);
        fullImage.current = { href, at: Date.now(), promise };
        return promise;
    };
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
                const url = (await fetchThumbnail(href, session, ['medium', 'small'], abort.signal)).url;
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
            <a
                href={href}
                aria-label={label}
                target="_blank"
                rel="noopener noreferrer"
                onPointerEnter={() => void prefetchFullImage()}
                onFocus={() => void prefetchFullImage()}
                onTouchStart={() => void prefetchFullImage()}
                onClick={(event) => {
                    // A loaded thumbnail opens in the app; without one, or with a modifier key, the link opens OneDrive.
                    if (!src || !session || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0)
                        return;
                    event.preventDefault();
                    event.stopPropagation();
                    const thumbnail = event.currentTarget.querySelector('img');
                    const ratio =
                        thumbnail?.naturalWidth && thumbnail.naturalHeight
                            ? thumbnail.naturalWidth / thumbnail.naturalHeight
                            : 4 / 3;
                    prefetchFullImage()?.then(
                        (image) => setViewing({ ratio, image }),
                        (reason: unknown) =>
                            setViewing({
                                ratio,
                                failure: reason instanceof Error ? reason.message : 'The full image is unavailable.',
                            })
                    );
                }}
            >
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
            {viewing && (
                <ImageViewer
                    href={href}
                    label={label}
                    ratio={viewing.ratio}
                    image={viewing.image}
                    failure={viewing.failure}
                    onClose={() => setViewing(null)}
                />
            )}
        </span>
    );
}
