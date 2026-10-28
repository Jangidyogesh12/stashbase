/**
 * Settling the open drafts that a rename, a deletion, a close, or a release
 * has to deal with before it can proceed.
 *
 * These four share one rule: the work in an open editor is never dropped to
 * make an operation succeed. A mutation saves the affected drafts first and
 * holds them locked until it knows its outcome; a close saves the draft or,
 * when there is nothing to save it to, asks the reader instead of quietly
 * refusing. The open set owns which tabs exist, so nothing here decides that
 * on its own: it either settles the work or hands the reader the choice.
 */
import type { StoreApi } from 'zustand/vanilla';

import type { DocumentRuntime } from '@/features/documents/application/document-runtime';
import {
  isDocumentDirty,
  sourceIdentity,
  type DocumentScope,
} from '@/features/documents/domain/document';
import {
  clearDocumentCloseDecision,
  closeDocumentTab,
  openDocumentTab,
  requestDocumentClose,
  type DocumentTabsState,
} from '@/features/documents/domain/tabs';

import type { DocumentQueryScope, DocumentSourcePort } from './ports';

/** What settling a draft needs from the open set it runs inside. */
export interface DraftSettlementContext {
  createQueries: (scope: DocumentScope) => DocumentQueryScope;
  /** Whether the open set has been disposed. Read again after every await. */
  disposed: () => boolean;
  /** The open documents by tab id, as the open set holds them. */
  documents: Map<string, DocumentRuntime>;
  folderPath: string;
  history: { rename(folderPath: string, from: string, to: string): void };
  keep(tabId: string): boolean;
  navigation: { activate(tabId: string | null): void };
  retireChild(tabId: string): void;
  /** A closed tab may still have an HTML form owning its shared data. */
  releaseChild(tabId: string): void;
  /** Refuses the completions of tabs transitions started before this one. */
  retireOperations(): void;
  saveDocuments(documents: Iterable<DocumentRuntime>): Promise<boolean>;
  sourceIds: Map<string, string>;
  store: StoreApi<DocumentTabsState>;
  /** Paths whose last mutation never reported an outcome. */
  uncertainMutations: Set<string>;
}

/** Save shared drafts and reveal the actual source when a form cannot settle. */
export async function saveOpenDocuments(
  context: Pick<DraftSettlementContext, 'store' | 'navigation'>,
  api: DocumentSourcePort,
  documents: Iterable<DocumentRuntime>,
): Promise<boolean> {
  for (const document of documents) {
    if (document.signal.aborted) continue;
    if (!(await document.save(api))) {
      const failed = document.htmlData?.store.getState().document ?? document;
      context.store.setState((state) =>
        openDocumentTab(state, { id: failed.scope.id, source: failed.scope.source }, false),
      );
      context.navigation.activate(failed.scope.id);
      return false;
    }
  }
  return true;
}

/**
 * Runs `operation` against `path`, answering whether it completed. The
 * operation reports the new path of a rename, `null` for a deletion, and
 * `undefined` when its outcome is unknown.
 */
export async function mutateOpenSources(
  context: DraftSettlementContext,
  path: string,
  operation: () => Promise<string | null | undefined>,
): Promise<boolean> {
  const {
    createQueries,
    documents,
    folderPath,
    history,
    keep,
    navigation,
    retireChild,
    retireOperations,
    saveDocuments,
    sourceIds,
    store,
    uncertainMutations,
  } = context;
  if (context.disposed()) return false;
  if (
    [...uncertainMutations].some(
      (p) => p !== path && (p.startsWith(`${path}/`) || path.startsWith(`${p}/`)),
    )
  )
    return false;
  const affected = [...documents.values()].filter(
    (document) =>
      document.scope.source.folderPath === folderPath &&
      (document.scope.source.path === path || document.scope.source.path.startsWith(`${path}/`)),
  );
  for (const document of affected) {
    keep(document.scope.id);
    document.setMutationPending(true);
  }
  try {
    if (!(await saveDocuments(affected)) || context.disposed()) return false;
    const destination = await operation();
    if (destination === undefined) {
      uncertainMutations.add(path);
      return false;
    }
    uncertainMutations.delete(path);
    if (context.disposed()) return false;
    for (const document of affected) {
      const { id, source } = document.scope;
      if (destination === null) {
        retireChild(id);
        store.setState((state) => closeDocumentTab(state, id));
      } else {
        sourceIds.delete(sourceIdentity(source));
        document.rebind(
          { ...source, path: destination + source.path.slice(path.length) },
          createQueries,
        );
        sourceIds.set(sourceIdentity(document.scope.source), id);
      }
    }
    if (destination !== null) {
      store.setState((state) => ({
        ...state,
        tabs: state.tabs.map((tab) => ({
          ...tab,
          source: documents.get(tab.id)?.scope.source ?? tab.source,
        })),
      }));
      history.rename(folderPath, path, destination);
    }
    navigation.activate(store.getState().activeTabId);
    retireOperations();
    return true;
  } finally {
    if (!uncertainMutations.has(path))
      for (const document of affected) document.setMutationPending(false);
  }
}

/**
 * Whether this document holds work whose file is gone. Closing it would drop
 * the text and no save can settle it first, which is what separates it from an
 * ordinary dirty draft.
 */
export function isDetachedDraft(document: DocumentRuntime): boolean {
  const editor = document.store.getState().editor;
  return editor !== null && editor.save.kind === 'detached' && isDocumentDirty(editor);
}

/**
 * Drops a tab and the document behind it, then hands the next tab to
 * navigation. Nothing here settles a save: every caller has already decided
 * what happens to the work.
 */
export function dropSettledTab(
  context: DraftSettlementContext,
  tabId: string,
  discard = false,
): void {
  if (discard) context.retireChild(tabId);
  else context.releaseChild(tabId);
  context.store.setState((state) => closeDocumentTab(state, tabId));
  context.navigation.activate(context.store.getState().activeTabId);
  context.retireOperations();
}

/**
 * Refuses whatever asked to settle this tab and puts the question to the
 * reader instead, with the tab in front of them. Answers `false` so a caller
 * can return it as its own refusal.
 */
export function askAboutDraft(context: DraftSettlementContext, tabId: string): false {
  const document = context.documents.get(tabId);
  if (document)
    context.store.setState((state) =>
      openDocumentTab(state, { id: tabId, source: document.scope.source }, false),
    );
  context.store.setState((state) => requestDocumentClose(state, tabId));
  context.navigation.activate(tabId);
  return false;
}

/**
 * Closes the tab a standing question is about, dropping its draft. Retiring
 * the child aborts its reads and refuses any save still in flight, so nothing
 * lands under the closed tab.
 */
export function closeDecidedTab(context: DraftSettlementContext): boolean {
  const decision = context.store.getState().closeDecision;
  if (context.disposed() || !decision || !context.documents.has(decision.tabId)) {
    context.store.setState((state) => clearDocumentCloseDecision(state));
    return false;
  }
  dropSettledTab(context, decision.tabId, true);
  return true;
}
