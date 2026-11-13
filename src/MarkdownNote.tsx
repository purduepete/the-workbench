import {
    Children,
    createContext,
    isValidElement,
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { Root, RootContent } from 'mdast';
import type { Plugin } from 'unified';
import { ChevronDown, Ellipsis, Info, Plus } from 'lucide-react';
import { ImageLinkEditor } from './ImageLinks';
import { OneDriveThumbnail } from './OneDriveThumbnail';
import { oneDriveImageUrl } from './oneDriveLinks';
import { setMarkdownTask } from './markdownTasks';

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

/** A request from outside the note to expand or collapse every section; `seq` changes on each request. */
export interface SectionCommand {
    expanded: boolean;
    seq: number;
}

const SectionCommandContext = createContext<SectionCommand | null>(null);

/** Wraps a section's heading and body with something beside it, such as its commentary rail. */
export type SectionAside = (
    heading: string,
    content: ReactNode,
    section: { expanded: boolean; setExpanded: (expanded: boolean) => void }
) => ReactNode;
const SectionAsideContext = createContext<SectionAside | null>(null);

/** The plain text of rendered Markdown children, for naming a section. */
function textOf(node: ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
    return '';
}

/** Counts the `## ` headings that become collapsible sections. */
export function countNoteSections(body: string): number {
    return body.match(/^## \S/gm)?.length ?? 0;
}

function CollapsibleSection({ children }: { children?: ReactNode }) {
    const command = useContext(SectionCommandContext);
    const aside = useContext(SectionAsideContext);
    const [expanded, setExpanded] = useState(command?.expanded ?? true);
    const [appliedSeq, setAppliedSeq] = useState(command?.seq ?? 0);
    if (command && command.seq !== appliedSeq) {
        setAppliedSeq(command.seq);
        setExpanded(command.expanded);
    }
    const headingId = `note-section-heading-${useId()}`;
    const regionId = `note-section-body-${useId()}`;
    const items = Children.toArray(children);
    const [heading, ...body] = items;

    if (!isValidElement<{ children?: ReactNode }>(heading) || heading.type !== 'h2') {
        return <section>{children}</section>;
    }

    const content = (
        <>
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
        </>
    );
    return (
        <section className="markdown-section">
            {aside ? aside(textOf(heading.props.children), content, { expanded, setExpanded }) : content}
        </section>
    );
}

interface HastLike {
    type: string;
    tagName?: string;
    value?: string;
    children?: HastLike[];
    position?: { start: { offset?: number } };
}

/** The item's own words for its checkbox label, without nested lists. */
function taskItemLabel(node: HastLike | undefined): string {
    if (!node) return '';
    if (node.type === 'text') return node.value ?? '';
    if (node.tagName === 'ul' || node.tagName === 'ol' || node.tagName === 'input') return '';
    return (node.children ?? []).map(taskItemLabel).join('').trim();
}

function MarkdownListItem({
    node,
    className,
    body,
    onBodyChange,
    children,
}: {
    node?: HastLike;
    className?: string;
    body: string;
    onBodyChange?: (body: string) => void;
    children?: ReactNode;
}) {
    if (!className?.split(' ').includes('task-list-item')) return <li className={className}>{children}</li>;
    const items = Children.toArray(children);
    const boxIndex = items.findIndex(
        (child) => isValidElement<{ type?: string }>(child) && child.props.type === 'checkbox'
    );
    const box = items[boxIndex];
    const checked = isValidElement<{ checked?: boolean }>(box) && Boolean(box.props.checked);
    const rest = items.filter((_, index) => index !== boxIndex);
    const isList = (child: ReactNode) => isValidElement(child) && (child.type === 'ul' || child.type === 'ol');
    const own = rest.filter((child) => !isList(child));
    const nested = rest.filter(isList);
    const offset = node?.position?.start.offset;
    const editable = Boolean(onBodyChange) && offset !== undefined;
    const Text = own.some((child) => isValidElement(child) && child.type === 'p') ? 'div' : 'span';
    return (
        <li className={className} data-checked={checked}>
            <input
                type="checkbox"
                className="markdown-task-checkbox"
                checked={checked}
                disabled={!editable}
                readOnly={!editable}
                aria-label={taskItemLabel(node) || 'Checklist item'}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                    if (!editable || offset === undefined) return;
                    const next = setMarkdownTask(body, offset, event.target.checked);
                    if (next !== null && next !== body) onBodyChange?.(next);
                }}
            />
            <Text className="markdown-task-text">{own}</Text>
            {nested}
        </li>
    );
}

export function MarkdownNoteBody({
    body,
    className = 'markdown-body',
    onBodyChange,
    sectionCommand = null,
    sectionAside = null,
}: {
    body: string;
    className?: string;
    /** When given, task-list checkboxes are clickable and report the updated Markdown. */
    onBodyChange?: (body: string) => void;
    /** Expands or collapses every section when its `seq` changes. */
    sectionCommand?: SectionCommand | null;
    /** Renders each `## ` section through this, for example to add a commentary rail. */
    sectionAside?: SectionAside | null;
}) {
    return (
        <SectionAsideContext.Provider value={sectionAside}>
            <SectionCommandContext.Provider value={sectionCommand}>
                <div className={className}>
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks, remarkNoteSections]}
                        urlTransform={allowedMarkdownUrl}
                        components={{
                            li: ({ node, className: itemClass, children }) => (
                                <MarkdownListItem
                                    node={node}
                                    className={itemClass}
                                    body={body}
                                    onBodyChange={onBodyChange}
                                >
                                    {children}
                                </MarkdownListItem>
                            ),
                            a: ({ href, children }) => {
                                const safeHref = allowedMarkdownUrl(href ?? '', 'href');
                                if (oneDriveImageUrl(safeHref)) {
                                    return (
                                        <OneDriveThumbnail
                                            href={safeHref}
                                            label={
                                                typeof children === 'string'
                                                    ? children
                                                    : Children.toArray(children).join('')
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
            </SectionCommandContext.Provider>
        </SectionAsideContext.Provider>
    );
}

export function ExpandableMarkdownBody({
    body,
    id,
    className,
    onBodyChange,
}: {
    body: string;
    id: string;
    className: string;
    onBodyChange?: (body: string) => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const container = containerRef.current;
        const content = contentRef.current;
        if (!container || !content) return;
        const measure = () => {
            const bounds = content.getBoundingClientRect();
            const style = getComputedStyle(container);
            const limit = parseFloat(style.lineHeight) * Number(style.getPropertyValue('--details-lines'));
            const range = document.createRange();
            const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
            const rects: DOMRect[] = [];
            while (walker.nextNode()) {
                if (!walker.currentNode.textContent?.trim()) continue;
                range.selectNodeContents(walker.currentNode);
                rects.push(...range.getClientRects());
            }
            for (const image of content.querySelectorAll('img, svg')) rects.push(image.getBoundingClientRect());
            let cutoff = Math.min(limit, bounds.height);
            // Stop before any line or image crossing the compact preview's bottom edge.
            for (const rect of rects.sort((a, b) => b.bottom - a.bottom)) {
                const top = rect.top - bounds.top;
                const bottom = rect.bottom - bounds.top;
                if (top < cutoff && bottom > cutoff) cutoff = Math.max(0, top);
            }
            container.style.setProperty('--details-height', `${bounds.height}px`);
            container.style.setProperty('--details-collapsed-height', `${Math.floor(cutoff)}px`);
            container.dataset.truncated = String(bounds.height - Math.floor(cutoff) > 1);
        };
        measure();
        // Establish the measured preview height before enabling expansion transitions.
        container.getBoundingClientRect();
        container.dataset.measured = 'true';
        const observer = new ResizeObserver(measure);
        observer.observe(content);
        return () => observer.disconnect();
    }, [body]);

    return (
        <>
            <div ref={containerRef} id={id} className={className}>
                <div ref={contentRef} className="expandable-markdown-content">
                    <MarkdownNoteBody body={body} onBodyChange={onBodyChange} />
                </div>
            </div>
            <span className="details-more" aria-hidden="true">
                <Ellipsis size={14} />
            </span>
        </>
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
    ['Checkbox', '- [ ] to do\n- [x] done'],
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
            <p>Start a line with - [ ] for a checkbox. Tick it on the saved card; it saves as - [x].</p>
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
    defaultValue,
    onChange,
}: {
    label: string;
    bodyRef: RefObject<HTMLTextAreaElement | null>;
    name: string;
    maxLength: number;
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
