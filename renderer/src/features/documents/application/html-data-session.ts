/** One HTML document's access to a shared JSON draft; versions stay in Documents. */
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  isDocumentDirty,
  sameSource,
  type DocumentTextSource,
} from '@/features/documents/domain/document';
import {
  HtmlDataError,
  htmlDataSource,
  parseHtmlData,
  updateHtmlData,
} from '@/features/documents/domain/html-data';
import type { SourceReference } from '@/shared/domain/source-reference';

import type { DocumentRuntime } from './document-runtime';
import { DocumentSourceError, type DocumentSourcePort } from './ports';

interface HtmlDataState {
  document: DocumentRuntime | null;
  revision: number;
  refreshFailed: boolean;
}

export interface HtmlDataSession {
  readonly store: StoreApi<HtmlDataState>;
  load(relativePath?: string): Promise<unknown>;
  refresh(): Promise<void>;
  update(content: string): Promise<void>;
  save(): Promise<void>;
  flush(): Promise<boolean>;
}

export function createHtmlDataSession({
  owner,
  source,
  api,
  acquire,
  lookup,
  keep,
  reveal,
}: {
  owner: DocumentRuntime;
  source: SourceReference;
  api: DocumentSourcePort;
  acquire(source: SourceReference): DocumentRuntime;
  lookup(source: SourceReference): DocumentRuntime | null;
  keep(): void;
  reveal(document: DocumentRuntime): void;
}): HtmlDataSession {
  const store = createStore<HtmlDataState>(() => ({
    document: null,
    revision: 0,
    refreshFailed: false,
  }));
  const ownerScope = owner.capture();
  let seen: string | null = null;
  let notified: string | null = null;
  let loading: Promise<unknown> | null = null;
  let refreshing: Promise<void> | null = null;
  let acceptingLoad = false;
  let bound = false;
  let unsubscribe: (() => void) | undefined;
  owner.signal.addEventListener('abort', () => unsubscribe?.(), { once: true });
  const watch = (document: DocumentRuntime) => {
    if (store.getState().document === document) return;
    unsubscribe?.();
    unsubscribe = document.store.subscribe(({ editor, mutationPending }) => {
      if (
        acceptingLoad ||
        mutationPending ||
        document.signal.aborted ||
        !sameSource(document.scope.source, source) ||
        !editor ||
        isDocumentDirty(editor) ||
        editor.value === seen ||
        editor.value === notified
      )
        return;
      try {
        parseHtmlData(editor.value);
        notified = editor.value;
        store.setState((state) => ({ revision: state.revision + 1, refreshFailed: false }));
      } catch {
        // Keep the last usable form while a JSON source edit is incomplete.
        store.setState({ refreshFailed: true });
      }
    });
  };
  const assertOwner = () => {
    if (!owner.accept(ownerScope, () => undefined) || owner.store.getState().mutationPending)
      throw new HtmlDataError(
        'rejected',
        'The form was closed or moved. Reopen it before editing data.',
      );
    if (owner.store.getState().access !== 'editable')
      throw new HtmlDataError('rejected', 'Data editing is available only in the current project.');
  };
  const current = () => {
    assertOwner();
    const document = store.getState().document;
    if (
      !document ||
      document.signal.aborted ||
      document.scope.source.path !== source.path ||
      document.scope.source.folderPath !== source.folderPath
    )
      throw new HtmlDataError('rejected', 'Load the form data again before editing.');
    document.settleEdits();
    if (document.store.getState().mutationPending)
      throw new HtmlDataError('rejected', 'The data file is being moved or deleted.');
    return document;
  };
  const load = async () => {
    assertOwner();
    const captured = owner.capture();
    const standing = lookup(source);
    standing?.settleEdits();
    const beforeRead = standing?.store.getState().editor;
    let initial: DocumentTextSource;
    try {
      initial = await api.load(source, owner.signal);
      parseHtmlData(initial.content);
    } catch (error) {
      if (!(error instanceof DocumentSourceError) || error.kind !== 'missing') throw error;
      initial = { content: 'null', format: 'json', version: 'absent' };
    }
    if (!owner.accept(captured, () => undefined))
      throw new HtmlDataError('rejected', 'The form is no longer open.');
    assertOwner();
    const document = acquire(source);
    document.settleEdits();
    // A save or another editor may have completed while this read was in flight.
    // Only the unchanged reader may adopt its result.
    acceptingLoad = true;
    try {
      if (
        !document.store.getState().editor ||
        (document === standing && document.store.getState().editor === beforeRead)
      )
        document.reconcile(initial, { cache: true });
    } finally {
      acceptingLoad = false;
    }
    const value = document.store.getState().editor?.value;
    if (value === undefined) throw new HtmlDataError('rejected', 'The data file is not editable.');
    const parsed = parseHtmlData(value);
    seen = value;
    notified = value;
    watch(document);
    store.setState({ document, refreshFailed: false });
    return parsed;
  };
  const refresh = async () => {
    const document = current();
    const beforeRead = document.store.getState().editor;
    if (!beforeRead || isDocumentDirty(beforeRead)) return;
    const captured = document.capture();
    let next: DocumentTextSource;
    try {
      next = await api.load(source, owner.signal);
    } catch (error) {
      if (
        beforeRead.version === 'absent' &&
        error instanceof DocumentSourceError &&
        error.kind === 'missing'
      )
        return;
      throw error;
    }
    assertOwner();
    // Never replace an edit or save that arrived while the disk read was pending.
    if (document !== current() || document.store.getState().editor !== beforeRead) return;
    parseHtmlData(next.content);
    document.accept(captured, () => document.reconcile(next, { cache: true }));
    store.setState({ refreshFailed: false });
  };
  const flush = async () => {
    const document = store.getState().document;
    if (!document || document.signal.aborted) return true;
    if (!(await document.save(api))) {
      reveal(document);
      return false;
    }
    return true;
  };
  return {
    store,
    load(relativePath) {
      const requested =
        relativePath === undefined ? source : htmlDataSource(owner.scope.source, relativePath);
      if (!requested)
        return Promise.reject(new HtmlDataError('rejected', 'This is not an HTML document.'));
      if (bound && !sameSource(source, requested))
        return Promise.reject(
          new HtmlDataError(
            'rejected',
            'This page already loaded a different data file. Reopen it to change the binding.',
          ),
        );
      source = requested;
      bound = true;
      loading ??= load().finally(() => {
        loading = null;
      });
      return loading;
    },
    refresh() {
      refreshing ??= refresh()
        .catch(() => {
          if (owner.accept(ownerScope, () => undefined)) store.setState({ refreshFailed: true });
        })
        .finally(() => {
          refreshing = null;
        });
      return refreshing;
    },
    async update(content) {
      const document = current();
      const editor = document.store.getState().editor;
      if (!editor || seen === null)
        throw new HtmlDataError('rejected', 'Load the form data first.');
      if (
        editor.value !== seen ||
        editor.save.kind === 'conflict' ||
        editor.save.kind === 'merging'
      )
        throw new HtmlDataError(
          'rejected',
          'Data changed in another editor. Load it again before updating.',
        );
      const value = updateHtmlData(editor.value, content);
      seen = value;
      document.change(value);
      if (document.store.getState().editor?.value !== value)
        throw new HtmlDataError('rejected', 'The data update was refused.');
      const updated = document.store.getState().editor;
      if (updated && isDocumentDirty(updated)) keep();
    },
    async save() {
      const document = current();
      // An explicit first save creates even an unchanged null value. A mere
      // preview/close never creates its absent sibling.
      const editor = document.store.getState().editor;
      if (editor?.version === 'absent' && !isDocumentDirty(editor))
        document.store.setState({ editor: { ...editor, baseline: '', save: { kind: 'dirty' } } });
      if (!(await flush()))
        throw new HtmlDataError(
          'rejected',
          'Data was not saved. Resolve the problem in its JSON tab.',
        );
      assertOwner();
    },
    flush,
  };
}
