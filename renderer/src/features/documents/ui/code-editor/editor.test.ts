import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { createCodeEditor, normalizeEditorText } from './editor';

afterEach(() => {
  globalThis.document.body.replaceChildren();
});

function editorView(host: HTMLElement): EditorView {
  const editor = host.querySelector<HTMLElement>('.cm-editor'); // dom-contract: CodeMirror internals
  const view = editor ? EditorView.findFromDOM(editor) : null;
  if (!view) throw new Error('CodeMirror did not mount.');
  return view;
}

function createHost(): HTMLElement {
  const host = globalThis.document.createElement('div');
  globalThis.document.body.append(host);
  return host;
}

describe('code editor', () => {
  it('normalizes source line endings for CodeMirror display', () => {
    expect(normalizeEditorText('first\r\nsecond\rthird')).toBe('first\nsecond\nthird');
  });

  it('owns editing, read-only switching, source replacement, and Find', () => {
    const host = createHost();
    const onChange = vi.fn();
    const editor = createCodeEditor(host, {
      ariaLabel: 'notes.txt source',
      content: 'Alpha\nalpha_beta\nalpha',
      language: { kind: 'plain' },
      onChange,
      readOnly: true,
    });
    const view = editorView(host);

    expect(view.state.facet(EditorState.readOnly)).toBe(true);
    expect(view.contentDOM.getAttribute('aria-readonly')).toBe('true');
    // The Find bar keeps focus while the reader types and steps; a match the
    // editor took focus for would receive the next keystroke as an edit.
    const findInput = globalThis.document.createElement('input');
    globalThis.document.body.append(findInput);
    findInput.focus();
    expect(editor.find.setQuery('alpha', { caseSensitive: false, wholeWord: true })).toEqual({
      current: 1,
      total: 2,
    });
    expect(editor.find.next()).toEqual({ current: 2, total: 2 });
    expect(globalThis.document.activeElement).toBe(findInput);
    expect(view.state.selection.main).toMatchObject({ from: 17, to: 22 });
    const current = host.querySelector('.cm-find-match-current'); // dom-contract: CodeMirror marks
    expect(current?.textContent).toBe('alpha');
    expect(host.querySelectorAll('.cm-find-match')).toHaveLength(2); // dom-contract: CodeMirror marks
    editor.find.close();
    expect(host.querySelector('.cm-find-match')).toBeNull(); // dom-contract: CodeMirror marks

    editor.setReadOnly(false);
    expect(view.contentDOM.getAttribute('aria-readonly')).toBe('false');
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\nchanged' } });
    expect(onChange).toHaveBeenCalledWith('Alpha\nalpha_beta\nalpha\nchanged');

    onChange.mockClear();
    editor.applyContent('external\ntext');
    expect(view.state.doc.toString()).toBe('external\ntext');
    expect(onChange).not.toHaveBeenCalled();

    editor.destroy();
    expect(host.querySelector('.cm-editor')).toBeNull(); // dom-contract: CodeMirror internals
  });

  it('loads a recognized filename grammar without making code editable', async () => {
    const host = createHost();
    const editor = createCodeEditor(host, {
      ariaLabel: 'Read-only source.ts source',
      content: 'const answer: number = 42;',
      language: { fileName: 'source.ts', kind: 'filename' },
      onChange: vi.fn(),
      readOnly: true,
    });
    const view = editorView(host);

    await waitFor(() => {
      expect(view.state.languageDataAt('commentTokens', 0).length).toBeGreaterThan(0);
    });
    expect(view.state.facet(EditorState.readOnly)).toBe(true);

    editor.destroy();
  });

  it('leaves an unknown filename uncoloured instead of guessing a grammar', () => {
    const host = createHost();
    const editor = createCodeEditor(host, {
      ariaLabel: 'Read-only source.custom source',
      content: 'plain generic content',
      language: { fileName: 'source.custom', kind: 'filename' },
      onChange: vi.fn(),
      readOnly: true,
    });
    const view = editorView(host);

    expect(view.state.languageDataAt('commentTokens', 0)).toEqual([]);

    editor.destroy();
  });
});
