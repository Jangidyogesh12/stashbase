/** Versioned editor state and explicit save/conflict decisions for one open source. */
import { isExternalSource } from '@/shared/domain/external-source';
import type { SourceReference } from '@/shared/domain/source-reference';
import { basePathName } from '@/shared/utils/file-path';

import { documentTextFormat, type DocumentTextFormat } from './document-format';
import type { DocumentRevision } from './revision';

export interface DocumentScope {
  readonly generation: number;
  readonly id: string;
  readonly source: SourceReference;
}

export interface DocumentState {
  access: DocumentAccess;
  editor: DocumentEditorState | null;
  jsonSession: JsonDocumentSession;
  lifecycle: 'active' | 'disposed';
  markdownMode: MarkdownViewMode;
  mutationPending: boolean;
  pdfPage: number;
  readingRequest: number;
  /** The inline revision review, if one is open. Its transitions live in
   *  `./revision`; `editor.revision` below is an edit counter, not this. */
  revision: DocumentRevision;
  scope: DocumentScope;
}

export type DocumentAccess = 'editable' | 'read-only';

export type MarkdownViewMode = 'reading' | 'writer';

type JsonViewMode = 'source' | 'tree';

export interface JsonDocumentSession {
  expandedPaths: string[];
  search: string;
  searchOptions: { caseSensitive: boolean; wholeWord: boolean };
  selectedPath: string | null;
  viewMode: JsonViewMode | null;
}

export interface DocumentTextSource {
  content: string;
  format: DocumentTextFormat;
  version: string;
}

export interface DocumentTextSaveResult extends DocumentTextSource {
  indexWarning?: string;
}

export type DocumentConflictResolution = 'merge' | 'overwrite' | 'reload';

export interface DocumentConflictState {
  diskContent: string;
  diskVersion: string;
  editorContent: string;
  resolutionMessage: string | null;
  resolving: DocumentConflictResolution | null;
}

export type DocumentSaveState =
  | { kind: 'clean' }
  | { kind: 'conflict'; conflict: DocumentConflictState }
  /** The source file is gone, so this draft has nowhere to be written. Unlike
   *  `failed`, which is one refused attempt, this is a standing condition: it
   *  survives every edit and stops autosave, because repeating a write to a
   *  path that no longer exists cannot start succeeding on its own. Only a
   *  save that lands, or a clean reload of a restored file, leaves it. */
  | { kind: 'detached'; message: string }
  | { kind: 'merging'; message: string | null; finishing: boolean }
  | { kind: 'dirty' }
  | { kind: 'failed'; message: string }
  | { kind: 'saved' }
  | { kind: 'saving' }
  | { kind: 'warned'; message: string };

export interface DocumentEditorState {
  baseline: string;
  /** How many edits this buffer has taken, so a save that lands late knows
   *  whether the text it wrote is still on screen. Not the review above. */
  revision: number;
  save: DocumentSaveState;
  value: string;
  version: string;
}

export function isDocumentDirty(editor: DocumentEditorState): boolean {
  return (
    editor.save.kind === 'conflict' ||
    editor.save.kind === 'merging' ||
    editor.value !== editor.baseline
  );
}

export function documentConflict(editor: DocumentEditorState): DocumentConflictState | null {
  return editor.save.kind === 'conflict' ? editor.save.conflict : null;
}

export function documentSaveMessage(save: DocumentSaveState): string | null {
  switch (save.kind) {
    case 'detached':
    case 'failed':
    case 'warned':
      return save.message;
    case 'conflict':
      return save.conflict.resolutionMessage;
    case 'merging':
      return save.message;
    case 'clean':
    case 'dirty':
    case 'saved':
    case 'saving':
      return null;
    default: {
      const exhaustive: never = save;
      return exhaustive;
    }
  }
}

export function sourceIdentity(source: SourceReference): string {
  return JSON.stringify([source.folderPath, source.path]);
}

export function sameSource(left: SourceReference, right: SourceReference): boolean {
  return left.folderPath === right.folderPath && left.path === right.path;
}

export function sourceName(source: SourceReference): string {
  return basePathName(source.path);
}

/** A document is edited where it lives: in the window's own project, or as an
 *  external text file the reader dropped in, which saves through its grant. A
 *  source from another project folder is only read here. */
export function documentAccess(source: SourceReference, activeFolderPath: string): DocumentAccess {
  if (isExternalSource(source)) return documentTextFormat(source.path) ? 'editable' : 'read-only';
  return source.folderPath === activeFolderPath ? 'editable' : 'read-only';
}

export function documentEditorText(source: string): string {
  return source.replace(/\r\n?/gu, '\n');
}

export function createDocumentState(scope: DocumentScope, access: DocumentAccess): DocumentState {
  return {
    access,
    editor: null,
    jsonSession: {
      expandedPaths: ['$'],
      search: '',
      searchOptions: { caseSensitive: false, wholeWord: false },
      selectedPath: '$',
      viewMode: null,
    },
    lifecycle: 'active',
    mutationPending: false,
    markdownMode: access === 'editable' ? 'writer' : 'reading',
    pdfPage: 1,
    readingRequest: 0,
    revision: { kind: 'idle' },
    scope,
  };
}

export function setDocumentPdfPage(state: DocumentState, page: number): DocumentState {
  if (state.lifecycle === 'disposed' || !Number.isSafeInteger(page) || page < 1) return state;
  return state.pdfPage === page ? state : { ...state, pdfPage: page };
}

export function setDocumentJsonSession(
  state: DocumentState,
  patch: Partial<JsonDocumentSession>,
): DocumentState {
  if (state.lifecycle === 'disposed') return state;
  const jsonSession = { ...state.jsonSession, ...patch };
  if (
    jsonSession.viewMode === state.jsonSession.viewMode &&
    jsonSession.search === state.jsonSession.search &&
    jsonSession.selectedPath === state.jsonSession.selectedPath &&
    jsonSession.expandedPaths === state.jsonSession.expandedPaths &&
    jsonSession.searchOptions === state.jsonSession.searchOptions
  ) {
    return state;
  }
  return { ...state, jsonSession };
}

export function setDocumentMarkdownMode(
  state: DocumentState,
  mode: MarkdownViewMode,
): DocumentState {
  if (
    state.lifecycle === 'disposed' ||
    state.markdownMode === mode ||
    (mode === 'writer' && state.access !== 'editable')
  ) {
    return state;
  }
  return { ...state, markdownMode: mode };
}

export function reconcileDocumentSource(
  state: DocumentState,
  source: DocumentTextSource,
): DocumentState {
  if (state.lifecycle === 'disposed' || state.access !== 'editable' || state.mutationPending)
    return state;
  if (state.revision.kind !== 'idle') return state;
  const baseline = documentEditorText(source.content);
  const editor = state.editor;
  if (editor && (isDocumentDirty(editor) || editor.save.kind === 'saving')) return state;
  if (
    editor?.baseline === baseline &&
    editor.value === baseline &&
    editor.version === source.version
  ) {
    return state;
  }
  return {
    ...state,
    editor: {
      baseline,
      revision: editor?.revision ?? 0,
      save: { kind: 'clean' },
      value: baseline,
      version: source.version,
    },
  };
}

export function changeDocumentText(state: DocumentState, value: string): DocumentState {
  if (
    state.lifecycle === 'disposed' ||
    state.access !== 'editable' ||
    state.mutationPending ||
    !state.editor
  )
    return state;
  const editor = state.editor;
  if (editor.save.kind === 'conflict' || (editor.save.kind === 'merging' && editor.save.finishing))
    return state;
  if (editor.value === value) return state;
  const dirty = value !== editor.baseline;
  const save: DocumentSaveState =
    editor.save.kind === 'merging'
      ? { kind: 'merging', finishing: false, message: null }
      : editor.save.kind === 'saving'
        ? { kind: 'saving' }
        : // Typing does not bring the missing file back, so the draft stays
          // detached and keeps saying so. Reporting `dirty` here would let the
          // autosave scheduler start writing to the gone path again.
          editor.save.kind === 'detached'
          ? editor.save
          : dirty
            ? { kind: 'dirty' }
            : { kind: 'saved' };
  return {
    ...state,
    editor: { ...editor, revision: editor.revision + 1, save, value },
  };
}

export function beginDocumentSave(state: DocumentState): DocumentState {
  const editor = state.editor;
  if (!editor || state.lifecycle === 'disposed') return state;
  if (editor.save.kind === 'conflict' || !isDocumentDirty(editor)) return state;
  return { ...state, editor: { ...editor, save: { kind: 'saving' } } };
}

export function acceptDocumentSave(
  state: DocumentState,
  capturedRevision: number,
  result: DocumentTextSaveResult,
): DocumentState {
  const editor = state.editor;
  if (!editor || state.lifecycle === 'disposed') return state;
  const baseline = documentEditorText(result.content);
  const value = editor.revision === capturedRevision ? baseline : editor.value;
  const warning = result.indexWarning ?? null;
  const save: DocumentSaveState =
    value === baseline
      ? warning === null
        ? { kind: 'saved' }
        : { kind: 'warned', message: warning }
      : { kind: 'dirty' };
  return {
    ...state,
    editor: { ...editor, baseline, save, value, version: result.version },
  };
}

/** Moves an open editor to another save state, leaving its text untouched. */
function withSaveState(state: DocumentState, save: DocumentSaveState): DocumentState {
  const editor = state.editor;
  if (!editor || state.lifecycle === 'disposed') return state;
  return { ...state, editor: { ...editor, save } };
}

/**
 * The save destination is gone. The draft is kept exactly as it is; what
 * changes is that nothing will try to write it again until the reader decides
 * where it should go.
 */
export function detachDocumentSave(state: DocumentState, message: string): DocumentState {
  return withSaveState(state, { kind: 'detached', message });
}

export function rejectDocumentSave(state: DocumentState, message: string): DocumentState {
  return withSaveState(
    state,
    state.editor?.save.kind === 'merging'
      ? { kind: 'merging', finishing: false, message }
      : { kind: 'failed', message },
  );
}

export function disposeDocumentState(state: DocumentState): DocumentState {
  if (state.lifecycle === 'disposed') return state;
  return { ...state, lifecycle: 'disposed', revision: { kind: 'idle' } };
}
