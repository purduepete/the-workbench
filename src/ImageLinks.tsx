import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { FolderOpen, ImagePlus } from 'lucide-react';
import { imageLinkMarkdown, oneDriveImageUrl, splitImageLinks } from './oneDriveLinks';
import { browseOneDrive, getOneDriveSession, prepareOneDrive, subscribeOneDriveSession } from './oneDrivePicker';
import type { OneDriveSession, PickedImage } from './oneDrivePicker';
import { OneDriveThumbnail } from './OneDriveThumbnail';

export function ImageLinkEditor({ bodyRef }: { bodyRef: RefObject<HTMLTextAreaElement | null> }) {
    const [open, setOpen] = useState(false);
    const [label, setLabel] = useState('');
    const [error, setError] = useState('');
    const [pickerError, setPickerError] = useState('');
    const [preparedSession, setSession] = useState<OneDriveSession | null>(null);
    const signedInSession = useSyncExternalStore(subscribeOneDriveSession, getOneDriveSession);
    const session = signedInSession ?? preparedSession;
    const signedIn = signedInSession !== null;
    const [busy, setBusy] = useState(false);
    const operationRef = useRef<AbortController | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const id = useId();

    useEffect(() => () => operationRef.current?.abort(), []);

    const close = () => {
        operationRef.current?.abort();
        setBusy(false);
        setOpen(false);
        setLabel('');
        setError('');
        setPickerError('');
        triggerRef.current?.focus();
    };
    const insert = (image: PickedImage) => {
        const safeUrl = oneDriveImageUrl(image.url);
        if (!safeUrl) {
            setError('OneDrive returned an unsupported image link. Select another image.');
            return;
        }
        const textarea = bodyRef.current;
        if (!textarea) {
            setError('The text editor is unavailable. Close and reopen this editor.');
            return;
        }
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const prefix = start > 0 && textarea.value[start - 1] !== '\n' ? '\n' : '';
        const suffix = end < textarea.value.length && textarea.value[end] !== '\n' ? '\n' : '';
        const insertion = `${prefix}${imageLinkMarkdown(label || image.label, safeUrl)}${suffix}`;
        if (textarea.maxLength >= 0 && textarea.value.length - (end - start) + insertion.length > textarea.maxLength) {
            setError('Remove some text before adding an image link.');
            return;
        }
        textarea.setRangeText(insertion, start, end, 'end');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        close();
        textarea.focus();
    };
    const prepare = async () => {
        const controller = new AbortController();
        operationRef.current = controller;
        setBusy(true);
        setPickerError('');
        try {
            const loaded = await prepareOneDrive();
            if (!controller.signal.aborted) setSession(loaded);
        } catch (error) {
            if (!controller.signal.aborted)
                setPickerError(error instanceof Error ? error.message : 'OneDrive setup could not be loaded.');
        } finally {
            if (!controller.signal.aborted) setBusy(false);
        }
    };
    const browse = async () => {
        if (!session) {
            await prepare();
            return;
        }
        const controller = new AbortController();
        operationRef.current = controller;
        setBusy(true);
        setPickerError('');
        try {
            if (!signedIn) {
                await session.signIn(controller.signal);
            } else {
                const image = await browseOneDrive(session, controller.signal);
                if (image && !controller.signal.aborted) {
                    if (!label) setLabel(image.label);
                    insert(image);
                }
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                setPickerError(error instanceof Error ? error.message : 'OneDrive could not be opened.');
            }
        } finally {
            if (!controller.signal.aborted) setBusy(false);
        }
    };

    return (
        <div className="image-link-editor">
            <button
                ref={triggerRef}
                type="button"
                className="secondary-button"
                aria-expanded={open}
                aria-controls={id}
                onClick={() => {
                    if (open) close();
                    else {
                        setOpen(true);
                        if (!session) void prepare();
                    }
                }}
            >
                <ImagePlus size={14} aria-hidden="true" />
                Add image link
            </button>
            {open && (
                <div
                    id={id}
                    className="image-link-fields"
                    role="group"
                    aria-label="OneDrive image link"
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            event.stopPropagation();
                            close();
                        }
                    }}
                >
                    <div className="image-link-browse">
                        <button
                            type="button"
                            className="secondary-button"
                            disabled={busy}
                            aria-busy={busy}
                            onClick={() => void browse()}
                        >
                            <FolderOpen size={14} aria-hidden="true" />
                            {session && !signedIn ? 'Sign in to OneDrive' : 'Browse OneDrive'}
                        </button>
                        {signedIn && <span className="field-hint">Signed in. Browse OneDrive to select an image.</span>}
                    </div>
                    {pickerError && (
                        <p className="dialog-error" role="alert">
                            {pickerError}
                        </p>
                    )}
                    <label className="field-group">
                        <span className="field-label">Image label</span>
                        <input
                            className="field-input"
                            value={label}
                            maxLength={120}
                            placeholder="Image"
                            onChange={(event) => setLabel(event.currentTarget.value)}
                        />
                    </label>
                    {error && (
                        <p className="dialog-error" role="alert">
                            {error}
                        </p>
                    )}
                    <div className="image-link-actions">
                        <button type="button" className="secondary-button" onClick={close}>
                            Cancel image link
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function ImageLinkedBody({ body, className }: { body: string; className: string }) {
    const { text, links } = splitImageLinks(body);
    return (
        <>
            {text && <p className={className}>{text}</p>}
            {links.length > 0 && (
                <div className="image-links" aria-label="Image links">
                    {links.map((link, index) => (
                        <OneDriveThumbnail key={`${index}-${link.url}`} href={link.url} label={link.label} />
                    ))}
                </div>
            )}
        </>
    );
}
