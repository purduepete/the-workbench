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

const thumbnailUrlSchema = z.object({ url: z.string() });
const thumbnailsSchema = z.object({ value: z.array(z.record(z.string(), z.unknown())) });

/** Fetches a short-lived OneDrive thumbnail URL; sizes are tried in order (for example `c2560x2560`, `large`). */
export async function fetchThumbnailUrl(
    href: string,
    session: OneDriveSession,
    sizes: string[],
    signal: AbortSignal
): Promise<string> {
    const token = await session.token();
    if (!navigator.onLine) throw new Error('Offline. Open the image when connected.');
    const custom = sizes.find((size) => /^c\d+x\d+$/.test(size));
    const endpoint = thumbnailEndpoint(href, session);
    const response = await fetch(custom ? `${endpoint}?select=${custom}` : endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) throw new Error(`Thumbnail unavailable (HTTP ${response.status}). Sign in to OneDrive again.`);
    const set = thumbnailsSchema.parse(await response.json()).value[0] ?? {};
    for (const size of sizes) {
        const parsed = thumbnailUrlSchema.safeParse(set[size]);
        if (parsed.success) return safeThumbnailUrl(parsed.data.url);
    }
    throw new Error('OneDrive has no thumbnail for this image.');
}

async function fetchFullImageUrl(href: string, session: OneDriveSession, signal: AbortSignal): Promise<string> {
    try {
        return await fetchThumbnailUrl(href, session, ['c2560x2560'], signal);
    } catch (error) {
        if (signal.aborted) throw error;
        return fetchThumbnailUrl(href, session, ['large', 'medium'], signal);
    }
}

function ImageViewer({
    href,
    label,
    ratio,
    session,
    onClose,
}: {
    href: string;
    label: string;
    ratio: number;
    session: OneDriveSession;
    onClose: () => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [full, setFull] = useState('');
    const [error, setError] = useState('');

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (dialog && !dialog.open) dialog.showModal();
        dialog?.focus({ preventScroll: true });
        return () => {
            if (dialog?.open) dialog.close();
            if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        };
    }, []);

    useEffect(() => {
        const abort = new AbortController();
        void (async () => {
            try {
                const url = await fetchFullImageUrl(href, session, abort.signal);
                // Download and decode before showing, so the viewer never shows a partial or low-resolution image.
                const image = new Image();
                image.referrerPolicy = 'no-referrer';
                image.src = url;
                await image.decode();
                if (!abort.signal.aborted) setFull(url);
            } catch (reason) {
                if (!abort.signal.aborted)
                    setError(
                        reason instanceof Error && reason.name !== 'EncodingError'
                            ? reason.message
                            : 'The full image could not load.'
                    );
            }
        })();
        return () => abort.abort();
    }, [href, session]);
    const showSpinner = useDelayedLoading(!full && !error);

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
                {/* The frame takes the thumbnail's shape, so the window opens at its final size. */}
                <div className="image-viewer-frame" style={{ '--image-ratio': ratio } as CSSProperties}>
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
    const [viewing, setViewing] = useState(0);
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
                const url = await fetchThumbnailUrl(href, session, ['medium', 'small'], abort.signal);
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
                onClick={(event) => {
                    // A loaded thumbnail opens in the app; without one, or with a modifier key, the link opens OneDrive.
                    if (!src || !session || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0)
                        return;
                    event.preventDefault();
                    event.stopPropagation();
                    const thumbnail = event.currentTarget.querySelector('img');
                    // Viewing holds the image's width-to-height ratio; 0 means closed.
                    setViewing(
                        thumbnail?.naturalWidth && thumbnail.naturalHeight
                            ? thumbnail.naturalWidth / thumbnail.naturalHeight
                            : 4 / 3
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
            {viewing > 0 && session && src && (
                <ImageViewer
                    href={href}
                    label={label}
                    ratio={viewing}
                    session={session}
                    onClose={() => setViewing(0)}
                />
            )}
        </span>
    );
}
