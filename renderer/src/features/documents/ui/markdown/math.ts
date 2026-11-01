/**
 * Math for the Markdown surface, opened only by two dollars or a ```math /
 * ```latex fence — the rule the agent transcript follows.
 *
 * Crepe's own LaTeX feature reads single dollars as math and offers no switch,
 * so ordinary prices ("$0.10–$0.50") lost their dollar signs and turned
 * italic. Single dollars stay text here; a note written with `$x$` shows its
 * source instead of a formula.
 */
import { codeBlockConfig } from '@milkdown/kit/component/code-block';
import { editorViewCtx, remarkStringifyOptionsCtx, type Editor } from '@milkdown/kit/core';
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $nodeSchema, $prose, $remark, $view } from '@milkdown/kit/utils';
import { renderToString } from 'katex';
import remarkMath from 'remark-math';

/** Crepe's theme styles inline math by this node name. */
const MATH_INLINE = 'math_inline';
const ESCAPED_DOLLAR = 'stashbase_escaped_dollar';
const MATH_LANGUAGES = new Set(['latex', 'math']);

const KATEX_OPTIONS = { throwOnError: false, trust: false, maxExpand: 1000, maxSize: 20 };
const mathDecorationKey = new PluginKey<number>('stashbase-math-decorations');
const SINGLE_DOLLAR_SOURCE = /(?<!\\)\$([^\n$]+?)(?<!\\)\$/gu;
const BRACKET_INLINE_SOURCE = /(?<!\\)\\\(([^\n]+?)(?<!\\)\\\)/gu;
const BRACKET_DISPLAY_SOURCE = /(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/gu;

interface MarkdownNode {
  type: string;
  value?: string;
  lang?: string | null;
  children?: MarkdownNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}``

function remarkMathSyntax() {
  return $remark('remarkDoubleDollarMath', () => remarkMath, {
    // Single dollars are kept as editor source text. A decoration below draws
    // them as KaTeX without changing the ProseMirror document or its history.
    // This is why a mode change can be outside Undo/Redo.
    singleDollarTextMath: false,
  });
}

export interface MathModeRef {
  current: boolean;
}

function mathModeReader(mode: boolean | MathModeRef): () => boolean {
  return typeof mode === 'boolean' ? () => mode : () => mode.current;
}

function mathWidget(ownerDocument: Document, value: string, display: boolean): HTMLElement {
  const dom = ownerDocument.createElement('span');
  dom.className = display ? 'katex-display' : 'katex';
  dom.dataset.mathSource = value;
  dom.dataset.type = MATH_INLINE;
  dom.dataset.value = value;
  dom.contentEditable = 'false';
  dom.innerHTML = renderToString(value, { ...KATEX_OPTIONS, displayMode: display });
  return dom;
}

function mathDecorations(doc: ProseMirrorNode, mathMode: boolean): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === 'code_block') return false;
    if (!node.isText || node.marks.some((mark) => mark.type.name === 'code')) return;
    const patterns = mathMode
      ? [[SINGLE_DOLLAR_SOURCE, false], [BRACKET_INLINE_SOURCE, false], [BRACKET_DISPLAY_SOURCE, true]] as const
      : [[BRACKET_INLINE_SOURCE, false], [BRACKET_DISPLAY_SOURCE, true]] as const;
    for (const [pattern, display] of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(node.text ?? ''))) {
        const value = match[1] ?? '';
        decorations.push(
          // Keep the delimiter text in the ProseMirror model. Hiding it and
          // inserting a widget changes only presentation, so a toggle neither
          // changes saved Markdown nor invalidates old undo steps.
          Decoration.inline(position + match.index, position + match.index + match[0].length, {
            class: 'stashbase-math-source',
          }),
          Decoration.widget(
            position + match.index,
            (view) => mathWidget(view.dom.ownerDocument, value, display),
            {
            key: `stashbase-math:${display ? 'display' : 'inline'}:${match[0]}`,
            side: -1,
            },
          ),
        );
      }
      pattern.lastIndex = 0;
    }
  });
  return DecorationSet.create(doc, decorations);
}

function mathDecorationPlugin(readMathMode: () => boolean) {
  return $prose(
    () =>
      new Plugin<number>({
        key: mathDecorationKey,
        state: {
          init: () => 0,
          apply(transaction, revision) {
            return transaction.getMeta(mathDecorationKey) === 'refresh' ? revision + 1 : revision;
          },
        },
        props: {
          decorations(state) {
            // Read the revision so a mode refresh invalidates decoration props
            // even though it intentionally does not change document content.
            mathDecorationKey.getState(state);
            return mathDecorations(state.doc, readMathMode());
          },
        },
      }),
  );
}

/** Repaint source-backed math decorations without changing document content or
 * creating an undoable editor transaction. */
export function refreshMath(editor: import('@milkdown/crepe/builder').CrepeBuilder): void {
  editor.editor.action((context) => {
    const view = context.get(editorViewCtx);
    view.dispatch(view.state.tr.setMeta(mathDecorationKey, 'refresh').setMeta('addToHistory', false));
  });
}

const INLINE_LATEX = /(?<!\\)\\\(([^\n]+?)(?<!\\)\\\)/gu;
const DISPLAY_LATEX = /^\s*\\\[([\s\S]*?)(?<!\\)\\\]\s*$/u;

function sourceOf(node: MarkdownNode, source: string): string | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === 'number' && typeof end === 'number' ? source.slice(start, end) : null;
}

/** Markdown's escape processing otherwise turns `\\(...\\)` into plain text
 * before the math schema can see it. The source range lets this Remark pass
 * restore the delimiter meaning without changing the document's input. */
function latexDelimitersToMath(node: MarkdownNode, source: string): void {
  if (!node.children) return;
  const children: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type === 'code' || child.type === 'inlineCode') {
      children.push(child);
      continue;
    }
    if (child.type === 'paragraph') {
      const display = sourceOf(child, source)?.match(DISPLAY_LATEX);
      if (display) {
        children.push({ type: 'math', value: display[1] ?? '' });
        continue;
      }
    }
    if (child.type === 'text') {
      const raw = sourceOf(child, source);
      if (raw && INLINE_LATEX.test(raw)) {
        INLINE_LATEX.lastIndex = 0;
        let cursor = 0;
        let match: RegExpExecArray | null;
        while ((match = INLINE_LATEX.exec(raw))) {
          if (match.index > cursor) children.push({ type: 'text', value: raw.slice(cursor, match.index) });
          children.push({ type: 'inlineMath', value: match[1] ?? '' });
          cursor = match.index + match[0].length;
        }
        if (cursor < raw.length) children.push({ type: 'text', value: raw.slice(cursor) });
        INLINE_LATEX.lastIndex = 0;
        continue;
      }
      INLINE_LATEX.lastIndex = 0;
    }
    latexDelimitersToMath(child, source);
    children.push(child);
  }
  node.children = children;
}

/** Markdown normally consumes the slash in `\\$`. Keep that spelling in a
 * small inline atom so an edit made later still serializes as a literal dollar
 * when this project enables single-dollar math. */
function escapedDollarsToNodes(node: MarkdownNode, source: string): void {
  if (!node.children) return;
  const children: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type === 'code' || child.type === 'inlineCode') {
      children.push(child);
      continue;
    }
    if (child.type === 'text') {
      const raw = sourceOf(child, source);
      // Only use source slices when their sole Markdown transformation was
      // the dollar escape. That avoids taking ownership of unrelated escapes.
      if (raw && raw.includes('\\$') && raw.replaceAll('\\$', '$') === child.value) {
        let cursor = 0;
        let index = raw.indexOf('\\$');
        while (index >= 0) {
          if (index > cursor) children.push({ type: 'text', value: raw.slice(cursor, index) });
          children.push({ type: ESCAPED_DOLLAR });
          cursor = index + 2;
          index = raw.indexOf('\\$', cursor);
        }
        if (cursor < raw.length) children.push({ type: 'text', value: raw.slice(cursor) });
        continue;
      }
    }
    escapedDollarsToNodes(child, source);
    children.push(child);
  }
  node.children = children;
}

const remarkLatexDelimiters = $remark('remarkLatexDelimiters', () => () => (tree, file) => {
  if (typeof file.value === 'string') {
    latexDelimitersToMath(tree as MarkdownNode, file.value);
    escapedDollarsToNodes(tree as MarkdownNode, file.value);
  }
});

const escapedDollarSchema = $nodeSchema(ESCAPED_DOLLAR, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  parseMarkdown: {
    match: (node) => node.type === ESCAPED_DOLLAR,
    runner: (state, _node, type) => state.addNode(type),
  },
  toMarkdown: {
    match: (node) => node.type.name === ESCAPED_DOLLAR,
    runner: (state) => state.addNode(ESCAPED_DOLLAR),
  },
  toDOM: () => ['span', { 'data-type': ESCAPED_DOLLAR }, '$'],
}));

/** A `$$` block arrives as a LaTeX code block, so it edits and previews like
 *  one and saves back as `$$`. */
function mathBlocksToCode(node: MarkdownNode): void {
  node.children?.forEach((child, index, siblings) => {
    if (child.type === 'math') {
      siblings[index] = { type: 'code', lang: 'LaTeX', value: child.value ?? '' };
    } else {
      mathBlocksToCode(child);
    }
  });
}

const remarkMathBlockAsCode = $remark('remarkMathBlockAsCode', () => () => (tree) => {
  mathBlocksToCode(tree as MarkdownNode);
});

const mathInlineSchema = $nodeSchema(MATH_INLINE, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: { value: { default: '' } },
  parseDOM: [
    {
      tag: `span[data-type="${MATH_INLINE}"]`,
      getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? '' }),
    },
  ],
  toDOM: (node) => ['span', { 'data-type': MATH_INLINE, 'data-value': node.attrs.value as string }],
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === MATH_INLINE,
    runner: (state, node) => {
      state.addNode('inlineMath', undefined, node.attrs.value as string);
    },
  },
}));

/** Shows the formula; the source stays in `data-value` for copy and parse. */
const mathInlineView = $view(mathInlineSchema.node, () => (node, view) => {
  const value = node.attrs.value as string;
  const dom = view.dom.ownerDocument.createElement('span');
  dom.dataset.type = MATH_INLINE;
  dom.dataset.value = value;
  dom.innerHTML = renderToString(value, KATEX_OPTIONS);
  return { dom };
});

const mathBlockSchema = codeBlockSchema.extendSchema((previous) => (context) => {
  const base = previous(context);
  return {
    ...base,
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        // Only blocks that arrived as `$$` carry exactly this language, so a
        // ```latex fence keeps its fence.
        if (node.attrs.language !== 'LaTeX') {
          return base.toMarkdown.runner(state, node);
        }
        state.addNode('math', undefined, node.content.firstChild?.text ?? '');
      },
    },
  };
});

/** Add after `codeMirror`, whose preview hook this wraps. */
export function math(editor: Editor, mode: boolean | MathModeRef = false): void {
  const readMathMode = mathModeReader(mode);
  editor
    .config((context) => {
      context.update(codeBlockConfig.key, (previous) => ({
        ...previous,
        renderPreview: (language, content, applyPreview) =>
          MATH_LANGUAGES.has(language.toLowerCase()) && content.length > 0
            ? renderToString(content, { ...KATEX_OPTIONS, displayMode: true })
            : previous.renderPreview(language, content, applyPreview),
      }));
      context.update(remarkStringifyOptionsCtx, (previous) => ({
        ...previous,
        handlers: {
          ...previous.handlers,
          [ESCAPED_DOLLAR]: () => '\\$',
        },
      }));
    })
    .use(remarkMathSyntax())
    .use(remarkLatexDelimiters)
    .use(mathDecorationPlugin(readMathMode))
    .use(remarkMathBlockAsCode)
    .use(escapedDollarSchema)
    .use(mathInlineSchema)
    .use(mathInlineView)
    .use(mathBlockSchema);
}
