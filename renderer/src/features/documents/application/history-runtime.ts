/**
 * The document history's store and the three verbs over it. The tabs runtime
 * owns one per folder and decides when a visit is recorded; the back and
 * forward controls read the store and ask the tabs runtime to step, so the
 * cursor only moves once the document it names is actually in front of the
 * reader.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import { sameSource } from '@/features/documents/domain/document';
import {
  createDocumentHistoryState,
  forgetDocumentSource,
  nextDocumentVisit,
  previousDocumentVisit,
  recordDocumentVisit,
  stepDocumentHistoryBack,
  stepDocumentHistoryForward,
  type DocumentHistoryState,
  type DocumentVisit,
} from '@/features/documents/domain/history';
import type { SourceReference } from '@/shared/domain/source-reference';

export interface DocumentHistoryRuntime {
  readonly store: StoreApi<DocumentHistoryState>;
  /** The visit one step back, or null at the start. */
  previous(): DocumentVisit | null;
  /** The visit one step forward, or null at the end. */
  next(): DocumentVisit | null;
  /** Drops every visit to a source the window can no longer reopen. */
  forget(source: SourceReference): void;
  remember(source: SourceReference, scroll: { top: number; left: number }): void;
  record(visit: DocumentVisit): void;
  rename(folderPath: string, from: string, to: string): void;
  stepBack(): void;
  stepForward(): void;
}

export function createDocumentHistoryRuntime(): DocumentHistoryRuntime {
  const store = createStore<DocumentHistoryState>(createDocumentHistoryState);
  return {
    store,
    forget(source) {
      store.setState((state) => forgetDocumentSource(state, source));
    },
    next: () => nextDocumentVisit(store.getState()),
    previous: () => previousDocumentVisit(store.getState()),
    rename(folderPath, from, to) {
      store.setState((state) => ({
        ...state,
        entries: state.entries.map((visit) =>
          visit.source.folderPath === folderPath &&
          (visit.source.path === from || visit.source.path.startsWith(`${from}/`))
            ? {
                ...visit,
                source: { ...visit.source, path: to + visit.source.path.slice(from.length) },
              }
            : visit,
        ),
      }));
    },
    remember(source, scroll) {
      store.setState((state) => {
        const current = state.entries[state.index];
        if (!current || !sameSource(current.source, source)) return state;
        const entries = [...state.entries];
        entries[state.index] = { source: current.source, scroll };
        return { ...state, entries };
      });
    },
    record(visit) {
      store.setState((state) => recordDocumentVisit(state, visit));
    },
    stepBack() {
      store.setState(stepDocumentHistoryBack);
    },
    stepForward() {
      store.setState(stepDocumentHistoryForward);
    },
  };
}
