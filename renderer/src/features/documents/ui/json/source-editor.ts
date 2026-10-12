import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { bracketMatching, indentOnInput, indentUnit, syntaxTree } from '@codemirror/language';
import { EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

import {
  createCodeEditor,
  type CodeEditorSession,
} from '@/features/documents/ui/code-editor/editor';
import { codeSyntaxHighlighting } from '@/features/documents/ui/code-editor/surface';

const invalidDecorations = EditorView.decorations.compute(['doc'], (state) => {
  const marks: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (!node.type.isError || state.doc.length === 0) return;
      const from = node.from < node.to ? node.from : Math.max(0, node.from - 1);
      const to = node.from < node.to ? node.to : Math.min(state.doc.length, node.from + 1);
      if (from < to) marks.push(Decoration.mark({ class: 'cm-json-invalid' }).range(from, to));
    },
  });
  return Decoration.set(marks, true);
});

const activeIndentDecorations = EditorView.decorations.compute(['doc', 'selection'], (state) => {
  const line = state.doc.lineAt(state.selection.main.head);
  const leadingWhitespace = line.text.match(/^[\t ]+/u)?.[0];
  if (!leadingWhitespace) return Decoration.set([]);
  let columns = 0;
  for (const character of leadingWhitespace) {
    columns += character === '\t' ? 2 - (columns % 2) : 1;
  }
  const depth = Math.floor(columns / 2);
  if (depth === 0) return Decoration.set([]);
  return Decoration.set([
    Decoration.line({
      attributes: { style: `--cm-indent-depth: ${depth}` },
      class: 'cm-activeIndent',
    }).range(line.from),
  ]);
});

const jsonTheme = EditorView.theme({
  '&.cm-focused .cm-activeIndent::before': {
    backgroundImage:
      'repeating-linear-gradient(to right, transparent 0, transparent calc(2ch - 1px), color-mix(in oklab, var(--focus-ring) 42%, transparent) calc(2ch - 1px), color-mix(in oklab, var(--focus-ring) 42%, transparent) 2ch)',
    content: '""',
    inset: '0 auto 0 6px',
    pointerEvents: 'none',
    position: 'absolute',
    width: 'calc(var(--cm-indent-depth) * 2ch)',
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklab, var(--focus-ring) 18%, transparent)',
    boxShadow: 'inset 0 -1px var(--focus-ring)',
    color: 'inherit',
  },
  '&.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'var(--destructive-light)',
    color: 'var(--destructive)',
  },
  '.cm-json-invalid': {
    color: 'var(--destructive)',
    textDecoration: 'underline wavy var(--destructive)',
    textUnderlineOffset: '2px',
  },
});

/** The JSON source pane: the shared code editor plus JSON grammar and affordances. */
export function createJsonSourceEditor(
  host: HTMLElement,
  options: { content: string; onChange(value: string): void; readOnly: boolean },
): CodeEditorSession {
  return createCodeEditor(host, {
    ariaLabel: 'JSON source editor',
    content: options.content,
    extensions: [
      json(),
      indentUnit.of('  '),
      EditorState.tabSize.of(2),
      indentOnInput(),
      closeBrackets(),
      bracketMatching(),
      codeSyntaxHighlighting,
      invalidDecorations,
      activeIndentDecorations,
      jsonTheme,
    ],
    keyBindings: [...closeBracketsKeymap, indentWithTab],
    onChange: options.onChange,
    readOnly: options.readOnly,
  });
}
