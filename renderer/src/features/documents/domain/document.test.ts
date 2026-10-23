import { describe, expect, it } from 'vite-plus/test';

import { textSource } from '@/test/fakes/documents';

import { enterDocumentConflict } from './conflict-state';
import {
  acceptDocumentSave,
  beginDocumentSave,
  changeDocumentText,
  createDocumentState,
  documentAccess,
  documentEditorText,
  disposeDocumentState,
  isDocumentDirty,
  reconcileDocumentSource,
  sameSource,
  setDocumentJsonSession,
  setDocumentMarkdownMode,
  setDocumentPdfPage,
  sourceIdentity,
  sourceName,
} from './document';

describe('document identity', () => {
  it('keeps the owning folder in source identity', () => {
    const notes = { folderPath: '/project/notes', path: 'drafts/plan.md' };
    const archive = { folderPath: '/project/archive', path: 'drafts/plan.md' };

    expect(sameSource(notes, { ...notes })).toBe(true);
    expect(sameSource(notes, archive)).toBe(false);
    expect(sourceIdentity(notes)).not.toBe(sourceIdentity(archive));
    expect(sourceName(notes)).toBe('plan.md');
  });

  it('disposes document state without changing its source scope', () => {
    const scope = {
      generation: 2,
      id: 'tab-1',
      source: { folderPath: '/project/notes', path: 'plan.md' },
    };
    const disposed = disposeDocumentState(createDocumentState(scope, 'editable'));

    expect(disposed).toEqual({
      access: 'editable',
      editor: null,
      jsonSession: {
        expandedPaths: ['$'],
        search: '',
        searchOptions: { caseSensitive: false, wholeWord: false },
        selectedPath: '$',
        viewMode: null,
      },
      lifecycle: 'disposed',
      mutationPending: false,
      markdownMode: 'writer',
      pdfPage: 1,
      readingRequest: 0,
      revision: { kind: 'idle' },
      scope,
      tableMode: 'table',
    });
    expect(disposeDocumentState(disposed)).toBe(disposed);
  });

  it('grants edit capability only to sources in the active folder scope', () => {
    expect(
      documentAccess({ folderPath: '/project/notes', path: 'plan.md' }, '/project/notes'),
    ).toBe('editable');
    expect(
      documentAccess({ folderPath: '/project/archive', path: 'plan.md' }, '/project/notes'),
    ).toBe('read-only');
  });

  it('keeps Markdown mode with the document and refuses writer mode for read-only sources', () => {
    const scope = {
      generation: 1,
      id: 'tab-1',
      source: { folderPath: '/project/notes', path: 'plan.md' },
    };
    const editable = createDocumentState(scope, 'editable');
    const reading = setDocumentMarkdownMode(editable, 'reading');

    expect(editable.markdownMode).toBe('writer');
    expect(reading.markdownMode).toBe('reading');
    expect(setDocumentMarkdownMode(reading, 'writer').markdownMode).toBe('writer');
    expect(
      setDocumentMarkdownMode(createDocumentState(scope, 'read-only'), 'writer').markdownMode,
    ).toBe('reading');
  });

  it('retains a valid PDF page while the document runtime stays alive', () => {
    const scope = {
      generation: 1,
      id: 'tab-pdf',
      source: { folderPath: '/project/notes', path: 'paper.pdf' },
    };
    const initial = createDocumentState(scope, 'read-only');
    const pageSeven = setDocumentPdfPage(initial, 7);

    expect(pageSeven.pdfPage).toBe(7);
    expect(setDocumentPdfPage(pageSeven, 0)).toBe(pageSeven);
    expect(setDocumentPdfPage(pageSeven, 1.5)).toBe(pageSeven);
  });

  it('retains JSON presentation state in the document runtime without changing source authority', () => {
    const scope = {
      generation: 1,
      id: 'tab-json',
      source: { folderPath: '/project/notes', path: 'data.json' },
    };
    const state = setDocumentJsonSession(createDocumentState(scope, 'editable'), {
      expandedPaths: ['$', '$.items'],
      search: 'needle',
      selectedPath: '$.items[1]',
      viewMode: 'source',
    });

    expect(state.jsonSession).toMatchObject({
      expandedPaths: ['$', '$.items'],
      search: 'needle',
      selectedPath: '$.items[1]',
      viewMode: 'source',
    });
    expect(state.editor).toBeNull();
  });

  it('normalizes editor line endings while retaining a versioned baseline', () => {
    const scope = {
      generation: 1,
      id: 'tab-1',
      source: { folderPath: '/project/notes', path: 'notes.txt' },
    };
    const loaded = reconcileDocumentSource(
      createDocumentState(scope, 'editable'),
      textSource({ content: '\uFEFFone\r\ntwo\r\n', format: 'txt' }),
    );

    expect(documentEditorText('one\rtwo\r\n')).toBe('one\ntwo\n');
    expect(loaded.editor).toMatchObject({
      baseline: '\uFEFFone\ntwo\n',
      save: { kind: 'clean' },
      value: '\uFEFFone\ntwo\n',
      version: 'v1',
    });
  });

  it('makes the live draft dirty synchronously and preserves newer input after save', () => {
    const scope = {
      generation: 1,
      id: 'tab-1',
      source: { folderPath: '/project/notes', path: 'plan.md' },
    };
    let state = reconcileDocumentSource(
      createDocumentState(scope, 'editable'),
      textSource({ content: 'one\r\n' }),
    );
    state = changeDocumentText(state, 'first edit\n');
    const capturedRevision = state.editor?.revision ?? -1;
    state = beginDocumentSave(state);
    state = changeDocumentText(state, 'newer edit\n');
    state = acceptDocumentSave(
      state,
      capturedRevision,
      textSource({ content: 'first edit\r\n', version: 'v2' }),
    );

    expect(state.editor).toMatchObject({
      baseline: 'first edit\n',
      save: { kind: 'dirty' },
      value: 'newer edit\n',
      version: 'v2',
    });
  });

  it('keeps a conflicted draft recoverable', () => {
    const scope = {
      generation: 1,
      id: 'tab-1',
      source: { folderPath: '/project/notes', path: 'plan.md' },
    };
    let state = reconcileDocumentSource(
      createDocumentState(scope, 'editable'),
      textSource({ content: 'before' }),
    );
    state = changeDocumentText(state, 'draft');
    state = enterDocumentConflict(state, textSource({ content: 'newer disk', version: 'v2' }));

    expect(state.editor).toMatchObject({
      save: {
        conflict: {
          diskContent: 'newer disk',
          diskVersion: 'v2',
          editorContent: 'draft',
          resolutionMessage: null,
          resolving: null,
        },
        kind: 'conflict',
      },
      value: 'draft',
      version: 'v1',
    });
    expect(state.editor && isDocumentDirty(state.editor)).toBe(true);
  });
});
