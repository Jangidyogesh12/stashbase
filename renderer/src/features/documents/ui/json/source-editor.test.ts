import { insertBracket } from '@codemirror/autocomplete';
import { insertNewlineAndIndent } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { createJsonSourceEditor } from './source-editor';

afterEach(() => {
  globalThis.document.body.replaceChildren();
});

describe('JSON source editor', () => {
  it('keeps invalid JSON editable and distinguishes external source patches', async () => {
    const host = globalThis.document.createElement('div');
    globalThis.document.body.append(host);
    const onChange = vi.fn();
    const editor = createJsonSourceEditor(host, {
      content: '{"broken": tru}',
      onChange,
      readOnly: true,
    });
    const view = EditorView.findFromDOM(host.querySelector('.cm-editor') as HTMLElement); // dom-contract: CodeMirror internals
    expect(view).not.toBeNull();
    expect(view?.state.facet(EditorState.readOnly)).toBe(true);

    editor.setReadOnly(false);
    view?.dispatch({ changes: { from: view.state.doc.length, insert: '\n' } });
    expect(onChange).toHaveBeenCalledWith('{"broken": tru}\n');

    onChange.mockClear();
    editor.applyContent('{"still": "malformed"');
    expect(view?.state.doc.toString()).toBe('{"still": "malformed"');
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.find.setQuery('still', { caseSensitive: true, wholeWord: true })).toEqual({
      current: 1,
      total: 1,
    });

    editor.destroy();
    expect(host.querySelector('.cm-editor')).toBeNull(); // dom-contract: CodeMirror internals
  });

  it('closes JSON delimiters and indents between braces', () => {
    const host = globalThis.document.createElement('div');
    globalThis.document.body.append(host);
    const editor = createJsonSourceEditor(host, {
      content: '',
      onChange: vi.fn(),
      readOnly: false,
    });
    const view = EditorView.findFromDOM(host.querySelector('.cm-editor') as HTMLElement); // dom-contract: CodeMirror internals
    expect(view).not.toBeNull();
    if (!view) return;

    const openingBrace = insertBracket(view.state, '{');
    expect(openingBrace).not.toBeNull();
    if (!openingBrace) return;
    view.dispatch(openingBrace);
    expect(view.state.doc.toString()).toBe('{}');
    expect(view.state.selection.main.from).toBe(1);

    expect(insertNewlineAndIndent(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('{\n  \n}');
    expect(view.state.selection.main.from).toBe(4);

    const openingQuote = insertBracket(view.state, '"');
    expect(openingQuote).not.toBeNull();
    if (!openingQuote) return;
    view.dispatch(openingQuote);
    expect(view.state.doc.toString()).toBe('{\n  ""\n}');
    expect(view.state.selection.main.from).toBe(5);

    editor.destroy();
  });
});
