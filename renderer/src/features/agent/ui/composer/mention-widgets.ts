/** What a marker looks like. Each chip is built as DOM for the editor's own
 *  document — never a global one — so the composer renders correctly inside a
 *  detached window, and each announces itself in the text layer because the
 *  chip carries no role of its own. The decoration set that maps markers onto
 *  these widgets lives here too, since it is the only reader of both. */
import { EditorView, WidgetType, type DecorationSet, Decoration } from '@codemirror/view';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { FileTypeIcon } from '@/components/ui/file-type-icon';
import type { ContextStatus } from '@/features/agent/domain/context';
import { shapeTokens } from '@/lib/shape-context';
import { prefersReducedMotion } from '@/shared/runtime/appearance-surface';
import { basePathName } from '@/shared/utils/file-path';

import { mentionField, statusField } from './mention-markers';

/** The word a bound source wears while it is not ready. The chip in the
 *  editor and the tile below it are naming the same state, so they read it
 *  from one map. */
export const STATUS_WORD: Record<ContextStatus, string> = {
  blocked: 'Blocked',
  failed: 'Failed',
  preparing: 'Preparing',
  ready: 'Ready',
  stale: 'Stale',
};

/** A token in running text is paper like every chip: a light hairline and
 *  no fill. The hairline is an inset ring rather than a border, because a
 *  border would add two pixels to the line the token sits in. */
const CHIP_CLASS = `mx-px inline-flex max-w-full items-center gap-1 ${shapeTokens.chip} px-1.5 align-baseline font-medium whitespace-nowrap text-foreground ring-1 ring-border/50 ring-inset`;

/** The root drawing each mention's glyph, keyed by the chip it sits in. */
const glyphRoots = new WeakMap<HTMLElement, Root>();

/** A mention's glyph is the shared `FileTypeIcon` itself, the mark the @ list
 *  and the sent bubble draw, so a file keeps one glyph from the moment it is
 *  picked. CodeMirror owns the chip's DOM, so a small React root draws the
 *  icon into a box of its size, and the chip's widget retires that root with
 *  the chip. */
function fileGlyph(chip: HTMLElement, path: string): HTMLElement {
  const host = chip.ownerDocument.createElement('span');
  host.className = 'flex size-3 shrink-0 text-muted-foreground';
  host.setAttribute('aria-hidden', 'true');
  const glyph = createRoot(host);
  glyph.render(createElement(FileTypeIcon, { 'aria-hidden': true, path, size: 12 }));
  glyphRoots.set(chip, glyph);
  return host;
}

function popIn(chip: HTMLElement, root: Document) {
  if (typeof chip.animate !== 'function' || prefersReducedMotion(root.defaultView)) return;
  chip.animate(
    [
      { opacity: 0, transform: 'scale(0.92)' },
      { opacity: 1, transform: 'scale(1)' },
    ],
    { duration: 80, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
  );
}

class SkillWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly fresh: boolean,
  ) {
    super();
  }

  override eq(other: SkillWidget) {
    return this.label === other.label;
  }

  override toDOM(view: EditorView) {
    const root = view.dom.ownerDocument;
    const chip = root.createElement('span');
    chip.className = CHIP_CLASS;
    chip.setAttribute('data-skill', this.label);

    const name = root.createElement('span');
    name.textContent = `/${this.label}`;
    chip.append(name);

    const spoken = root.createElement('span');
    spoken.className = 'sr-only';
    spoken.textContent = ` (selected skill: ${this.label})`;
    chip.append(spoken);

    if (this.fresh) popIn(chip, root);
    return chip;
  }

  override ignoreEvent() {
    return false;
  }
}

class MentionWidget extends WidgetType {
  constructor(
    private readonly path: string,
    private readonly status: ContextStatus,
    private readonly fresh: boolean,
  ) {
    super();
  }

  override eq(other: MentionWidget) {
    return this.path === other.path && this.status === other.status;
  }

  override toDOM(view: EditorView) {
    // The widget builds DOM for the editor's own document, never a global.
    const root = view.dom.ownerDocument;
    const chip = root.createElement('span');
    chip.className = CHIP_CLASS;
    chip.title = this.path;
    chip.setAttribute('data-mention', this.path);

    chip.append(fileGlyph(chip, this.path));

    // A long name gives way before the line does: the chip is at most the
    // line's width, and the name truncates inside it.
    const name = root.createElement('span');
    name.className = 'truncate';
    name.textContent = basePathName(this.path);
    chip.append(name);

    if (this.status !== 'ready') {
      const dot = root.createElement('span');
      const alarming = this.status === 'stale' || this.status === 'failed';
      dot.className = `size-1.5 shrink-0 rounded-full ${alarming ? 'bg-destructive' : 'bg-muted-foreground'}`;
      dot.title = STATUS_WORD[this.status];
      dot.setAttribute('aria-hidden', 'true');
      chip.append(dot);
    }

    // The chip has no role, so a label on it would be dropped; the full
    // path travels in the text layer instead.
    const spoken = root.createElement('span');
    spoken.className = 'sr-only';
    spoken.textContent =
      this.status === 'ready'
        ? ` (file mention: ${this.path})`
        : ` (file mention: ${this.path}, ${STATUS_WORD[this.status].toLowerCase()})`;
    chip.append(spoken);

    if (this.fresh) popIn(chip, root);
    return chip;
  }

  override destroy(dom: HTMLElement) {
    const glyph = glyphRoots.get(dom);
    if (!glyph) return;
    glyphRoots.delete(dom);
    // CodeMirror can drop a chip while React is committing, as when the
    // editor is torn down from an effect, and React refuses to unmount a root
    // synchronously then; the root goes once that work has finished.
    queueMicrotask(() => glyph.unmount());
  }

  override ignoreEvent() {
    return false;
  }
}

export const mentionDecorations = EditorView.decorations.compute(
  [mentionField, statusField],
  (state): DecorationSet => {
    const statuses = state.field(statusField);
    const decorations: ReturnType<Decoration['range']>[] = [];
    state.field(mentionField).between(0, state.doc.length, (from, to, mention) => {
      decorations.push(
        Decoration.replace({
          widget:
            mention.kind === 'skill'
              ? new SkillWidget(mention.path, mention.fresh)
              : new MentionWidget(mention.path, statuses[mention.path] ?? 'ready', mention.fresh),
        }).range(from, to),
      );
    });
    return Decoration.set(decorations, true);
  },
);
