import { defaultKeymap, history, historyField, historyKeymap } from '@codemirror/commands';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';

import type { DocumentFindController } from '@/features/documents/application/navigation-runtime';

import { codeFindHighlight, createCodeFindController } from './find-controller';
import { codeSurfaceExtensions, codeSyntaxHighlighting } from './surface';

export type CodeEditorLanguage = { kind: 'filename'; fileName: string } | { kind: 'plain' };

export interface CodeEditorSnapshot {
  content: string;
  state: unknown;
  top: number;
  left: number;
}

export interface CodeEditorSession {
  snapshot(): CodeEditorSnapshot;
  restore(snapshot: CodeEditorSnapshot): void;
  applyContent(content: string): void;
  destroy(): void;
  find: DocumentFindController;
  focus(): void;
  setReadOnly(readOnly: boolean): void;
}

export interface CodeEditorOptions {
  ariaLabel: string;
  content: string;
  extensions?: Extension;
  keyBindings?: readonly KeyBinding[];
  language?: CodeEditorLanguage;
  onChange(value: string): void;
  readOnly: boolean;
}

export function normalizeEditorText(content: string): string {
  return content.replace(/\r\n?/gu, '\n');
}

function readOnlyExtensions(readOnly: boolean) {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({ 'aria-readonly': String(readOnly) }),
  ];
}

export function createCodeEditor(host: HTMLElement, options: CodeEditorOptions): CodeEditorSession {
  const readOnly = new Compartment();
  const syntax = new Compartment();
  let applyingExternal = false;
  let destroyed = false;
  const config = {
    doc: normalizeEditorText(options.content),
    extensions: [
      history(),
      syntax.of([]),
      readOnly.of(readOnlyExtensions(options.readOnly)),
      codeSurfaceExtensions,
      codeFindHighlight,
      options.extensions ?? [],
      keymap.of([...(options.keyBindings ?? []), ...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({
        'aria-label': options.ariaLabel,
        autocapitalize: 'off',
        spellcheck: 'false',
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || applyingExternal) return;
        options.onChange(update.state.doc.toString());
      }),
    ],
  };
  const view = new EditorView({ parent: host, state: EditorState.create(config) });

  if (options.language?.kind === 'filename') {
    const description = LanguageDescription.matchFilename(languages, options.language.fileName);
    if (description) {
      void description.load().then((support) => {
        if (destroyed) return;
        view.dispatch({ effects: syntax.reconfigure([support, codeSyntaxHighlighting]) });
      });
    }
  }

  return {
    snapshot() {
      return {
        content: view.state.doc.toString(),
        state: view.state.toJSON({ history: historyField }),
        top: view.scrollDOM.scrollTop,
        left: view.scrollDOM.scrollLeft,
      };
    },
    restore(snapshot) {
      if (snapshot.content !== normalizeEditorText(options.content)) return;
      view.setState(EditorState.fromJSON(snapshot.state, config, { history: historyField }));
      view.scrollDOM.scrollTop = snapshot.top;
      view.scrollDOM.scrollLeft = snapshot.left;
    },
    applyContent(next) {
      const normalizedNext = normalizeEditorText(next);
      const current = view.state.doc.toString();
      if (current === normalizedNext) return;
      let from = 0;
      while (
        from < current.length &&
        from < normalizedNext.length &&
        current[from] === normalizedNext[from]
      ) {
        from += 1;
      }
      let currentTo = current.length;
      let nextTo = normalizedNext.length;
      while (
        currentTo > from &&
        nextTo > from &&
        current[currentTo - 1] === normalizedNext[nextTo - 1]
      ) {
        currentTo -= 1;
        nextTo -= 1;
      }
      applyingExternal = true;
      try {
        view.dispatch({
          changes: { from, insert: normalizedNext.slice(from, nextTo), to: currentTo },
        });
      } finally {
        applyingExternal = false;
      }
    },
    destroy() {
      destroyed = true;
      view.destroy();
    },
    find: createCodeFindController(() => view),
    focus() {
      view.focus();
    },
    setReadOnly(next) {
      view.dispatch({ effects: readOnly.reconfigure(readOnlyExtensions(next)) });
    },
  };
}
