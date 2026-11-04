import { Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { Root, RootContent } from 'mdast';
import type { Plugin } from 'unified';
import { ChevronDown, Info, Plus } from 'lucide-react';
import { ImageLinkEditor } from './ImageLinks';
import { OneDriveThumbnail } from './OneDriveThumbnail';
import { oneDriveImageUrl } from './oneDriveLinks';

interface NoteSection {
    type: 'noteSection';
    data: { hName: 'section' };
    children: RootContent[];
}

declare module 'mdast' {
    interface RootContentMap {
        noteSection: NoteSection;
    }
}

function textifyHtml(node: RootContent): RootContent {
    if (node.type === 'html') return { type: 'text', value: node.value };
    if ('children' in node) node.children = node.children.map((child) => textifyHtml(child));
    return node;
}

export const remarkNoteSections: Plugin<[], Root> = () => (tree) => {
    const children: RootContent[] = [];
    let section: NoteSection | undefined;

    for (const original of tree.children) {
        const node = textifyHtml(original);
        if (node.type === 'definition') {
            children.push(node);
            continue;
        }

        if (node.type === 'heading' && node.depth <= 2) {
            section = undefined;
            if (node.depth === 2) {
                section = { type: 'noteSection', data: { hName: 'section' }, children: [node] };
                children.push(section);
            } else {
                children.push(node);
            }
            continue;
        }

        if (section) section.children.push(node);
        else children.push(node);
    }

    tree.children = children;
};

function allowedMarkdownUrl(url: string, key: string): string {
    const match = /^([a-z][a-z\d+.-]*):/i.exec(url.trim());
    if (!match) return '';
    const protocol = `${match[1].toLowerCase()}:`;
    const allowed = key === 'href' ? ['http:', 'https:', 'mailto:'] : ['http:', 'https:'];
    return allowed.includes(protocol) ? url : '';
}

function CollapsibleSection({ children }: { children?: ReactNode }) {
    const [expanded, setExpanded] = useState(true);
    const headingId = `note-section-heading-${useId()}`;
    const regionId = `note-section-body-${useId()}`;
    const items = Children.toArray(children);
    const [heading, ...body] = items;

    if (!isValidElement<{ children?: ReactNode }>(heading) || heading.type !== 'h2') {
        return <section>{children}</section>;
    }

    return (
        <section className="markdown-section">
            <h2 className="markdown-section-heading" id={headingId}>
                <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={regionId}
                    onClick={() => setExpanded((value) => !value)}
                >
                    {heading.props.children}
                    <ChevronDown size={16} aria-hidden="true" />
                </button>
            </h2>
            <div id={regionId} role="region" aria-labelledby={headingId} hidden={!expanded}>
                {body}
            </div>
        </section>
    );
}

export function MarkdownNoteBody({ body, className = 'markdown-body' }: { body: string; className?: string }) {
    return (
        <div className={className}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks, remarkNoteSections]}
                urlTransform={allowedMarkdownUrl}
                components={{
                    a: ({ href, children }) => {
                        const safeHref = allowedMarkdownUrl(href ?? '', 'href');
                        if (oneDriveImageUrl(safeHref)) {
                            return (
                                <OneDriveThumbnail
                                    href={safeHref}
                                    label={
                                        typeof children === 'string' ? children : Children.toArray(children).join('')
                                    }
                                />
                            );
                        }
                        return safeHref ? (
                            <a href={safeHref} target="_blank" rel="noopener noreferrer">
                                {children}
                            </a>
                        ) : (
                            <span>{children}</span>
                        );
                    },
                    section: CollapsibleSection,
                }}
            >
                {body}
            </ReactMarkdown>
        </div>
    );
}

const markdownExamples = [
    ['Heading', '# Heading'],
    ['Section', '## Section'],
    ['Bold / italic', '**bold** / *italic*'],
    ['Bullet list', '- item'],
    ['Numbered list', '1. item'],
    ['Link', '[text](https://example.com)'],
    ['Divider', '---'],
    ['Quote', '> quote'],
    ['Inline code', '`code`'],
    ['Code block', '```\ncode\n```'],
    ['Task list', '- [ ] item'],
    ['Table', '| A | B |\n| --- | --- |\n| 1 | 2 |'],
] as const;

function MarkdownSyntaxHelp({ label, labelId }: { label: string; labelId: string }) {
    const [open, setOpen] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
    const [portalTarget, setPortalTarget] = useState<Element | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const pointerInside = useRef(false);
    const helpId = useId();

    const place = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.min(360, window.innerWidth - 16);
        const below = window.innerHeight - rect.bottom - 8;
        const above = rect.top - 8;
        const openUp = below < 240 && above > below;
        setPosition({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
            maxHeight: Math.max(0, openUp ? above : below),
            ...(openUp ? { bottom: window.innerHeight - rect.top } : { top: rect.bottom }),
        });
    }, []);

    useLayoutEffect(() => {
        setPortalTarget(triggerRef.current?.closest('dialog') ?? document.body);
    }, []);

    useLayoutEffect(() => {
        if (open) place();
    }, [open, place]);

    useEffect(() => {
        if (!open) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (
                event.target instanceof Node &&
                (wrapperRef.current?.contains(event.target) || panelRef.current?.contains(event.target))
            )
                return;
            setOpen(false);
            setPinned(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setPinned(false);
        };
        const handleScroll = (event: Event) => {
            if (!(event.target instanceof Node) || !panelRef.current?.contains(event.target)) place();
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', place);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', place);
        };
    }, [open, place]);

    const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
        const next = event.relatedTarget;
        if (next instanceof Node && (wrapperRef.current?.contains(next) || panelRef.current?.contains(next))) return;
        pointerInside.current = false;
        if (event.pointerType !== 'touch' && !pinned && !wrapperRef.current?.contains(document.activeElement))
            setOpen(false);
    };

    const panel = (
        <div
            ref={panelRef}
            id={helpId}
            className="markdown-help"
            role="tooltip"
            hidden={!open}
            style={position}
            onPointerEnter={() => {
                pointerInside.current = true;
            }}
            onPointerLeave={handlePointerLeave}
        >
            <strong>Markdown syntax</strong>
            <dl>
                {markdownExamples.map(([name, syntax]) => (
                    <div key={name}>
                        <dt>{name}</dt>
                        <dd>
                            <code>{syntax}</code>
                        </dd>
                    </div>
                ))}
            </dl>
            <p>Leave a blank line around a divider. A level 2 heading creates a collapsible section.</p>
        </div>
    );

    return (
        <div
            ref={wrapperRef}
            className="markdown-help-wrap"
            onPointerEnter={() => {
                pointerInside.current = true;
            }}
            onPointerLeave={handlePointerLeave}
            onBlur={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Node && (event.currentTarget.contains(next) || panelRef.current?.contains(next)))
                    return;
                if (next === null && pointerInside.current) return;
                setOpen(false);
                setPinned(false);
            }}
        >
            <div className="markdown-editor-label">
                <span className="field-label" id={labelId}>
                    {label}
                </span>
                <button
                    ref={triggerRef}
                    type="button"
                    className="markdown-help-trigger"
                    aria-label="Markdown syntax help"
                    aria-describedby={helpId}
                    aria-controls={helpId}
                    aria-expanded={open}
                    onPointerEnter={(event) => {
                        if (event.pointerType !== 'touch') setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onClick={() => {
                        setOpen(!pinned);
                        setPinned(!pinned);
                    }}
                >
                    <Info size={16} aria-hidden="true" />
                </button>
            </div>
            {portalTarget ? createPortal(panel, portalTarget) : panel}
        </div>
    );
}

export function MarkdownNoteEditor({
    label,
    bodyRef,
    name,
    maxLength,
    placeholder,
    defaultValue,
    onChange,
}: {
    label: string;
    bodyRef: RefObject<HTMLTextAreaElement | null>;
    name: string;
    maxLength: number;
    placeholder: string;
    defaultValue: string;
    onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}) {
    const [mode, setMode] = useState<'edit' | 'preview'>('edit');
    const [previewBody, setPreviewBody] = useState('');
    const [sectionError, setSectionError] = useState('');
    const labelId = useId();
    const style = { '--segment-index': mode === 'edit' ? 0 : 1 } as CSSProperties & {
        '--segment-index': number;
    };

    const showPreview = () => {
        setPreviewBody(bodyRef.current?.value ?? '');
        setMode('preview');
    };

    const insertSection = () => {
        const textarea = bodyRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const prefix = start > 0 && textarea.value[start - 1] !== '\n' ? '\n' : '';
        const insertion = `${prefix}## Section title\n`;
        if (textarea.value.length - (end - start) + insertion.length > maxLength) {
            setSectionError('Remove some text before adding a section.');
            return;
        }
        textarea.setRangeText(insertion, start, end, 'end');
        setSectionError('');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
    };

    return (
        <div className="field-group editor-body markdown-editor">
            <MarkdownSyntaxHelp label={label} labelId={labelId} />
            <div className="markdown-editor-toolbar">
                <div className="segmented markdown-mode" role="group" aria-label={`${label} mode`}>
                    <span className="segment-fill" style={style} aria-hidden="true" />
                    <button
                        type="button"
                        className="segment-button"
                        aria-pressed={mode === 'edit'}
                        onClick={() => setMode('edit')}
                    >
                        Edit
                    </button>
                    <button
                        type="button"
                        className="segment-button"
                        aria-pressed={mode === 'preview'}
                        onClick={showPreview}
                    >
                        Preview
                    </button>
                </div>
                {mode === 'edit' && (
                    <button type="button" className="secondary-button markdown-add-section" onClick={insertSection}>
                        <Plus size={14} aria-hidden="true" />
                        Add section
                    </button>
                )}
                {mode === 'edit' && <ImageLinkEditor bodyRef={bodyRef} />}
            </div>
            <textarea
                ref={bodyRef}
                id={`${labelId}-input`}
                aria-labelledby={labelId}
                className="field-textarea journal-textarea markdown-editor-textarea"
                name={name}
                maxLength={maxLength}
                placeholder={placeholder}
                defaultValue={defaultValue}
                hidden={mode === 'preview'}
                onChange={(event) => {
                    setPreviewBody(event.currentTarget.value);
                    setSectionError('');
                    onChange?.(event);
                }}
            />
            {sectionError && mode === 'edit' && (
                <span className="field-hint" role="alert">
                    {sectionError}
                </span>
            )}
            {mode === 'preview' && (
                <MarkdownNoteBody body={previewBody} className="markdown-body markdown-editor-preview" />
            )}
        </div>
    );
}
