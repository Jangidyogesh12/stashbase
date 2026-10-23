/**
 * The window's document browsing history: the sources a reader visited, in
 * the order they visited them, with the place each open landed on.
 *
 * An entry is a source and a location, never a tab. A preview tab that has
 * since been replaced is still a place the reader was, so stepping back to
 * it reopens the source rather than looking for a tab that is gone. The
 * cursor sits on the entry currently in front of the reader; stepping moves
 * the cursor, and a fresh visit from anywhere but the history itself cuts
 * off whatever lay ahead of it.
 */
import type { SourceReference } from '@/shared/domain/source-reference';

import { sameSource } from './document';
import type { DocumentLocation } from './location';

export interface DocumentVisit extends DocumentLocation {
  source: SourceReference;
}

export interface DocumentHistoryState {
  entries: DocumentVisit[];
  /** The entry in front of the reader, or -1 while nothing has been visited. */
  index: number;
}

/** How far back the history reaches before the oldest visits fall off. */
export const MAX_DOCUMENT_HISTORY = 100;

export function createDocumentHistoryState(): DocumentHistoryState {
  return { entries: [], index: -1 };
}

function sameLocation(a: DocumentLocation, b: DocumentLocation): boolean {
  return (
    JSON.stringify(a.scroll ?? null) === JSON.stringify(b.scroll ?? null) &&
    (a.anchor ?? null) === (b.anchor ?? null) &&
    JSON.stringify(a.search ?? null) === JSON.stringify(b.search ?? null)
  );
}

/**
 * Records a visit the reader made. A visit to the source already in front of
 * them replaces the current entry rather than stacking a duplicate, so
 * clicking the open tab or following a link within a page does not fill the
 * history with one file; the location it carries is the newer one, which is
 * where the reader now is.
 */
export function recordDocumentVisit(
  state: DocumentHistoryState,
  visit: DocumentVisit,
): DocumentHistoryState {
  const current = state.entries[state.index];
  const entry: DocumentVisit = {
    source: { ...visit.source },
    ...(visit.scroll === undefined ? {} : { scroll: { ...visit.scroll } }),
    ...(visit.anchor === undefined ? {} : { anchor: visit.anchor }),
    ...(visit.search === undefined ? {} : { search: { ...visit.search } }),
  };
  if (current && sameSource(current.source, visit.source)) {
    if (sameLocation(current, visit)) return state;
    const entries = [...state.entries];
    entries[state.index] = entry;
    return { ...state, entries };
  }
  const kept = state.entries.slice(0, state.index + 1);
  const entries = [...kept, entry].slice(-MAX_DOCUMENT_HISTORY);
  return { entries, index: entries.length - 1 };
}

/**
 * Drops every visit to `source`, keeping the cursor on the same place where
 * that place survives. An external file's read grant ends with its tab, so
 * the history must not offer a step back to a file it can no longer read.
 */
export function forgetDocumentSource(
  state: DocumentHistoryState,
  source: SourceReference,
): DocumentHistoryState {
  if (!state.entries.some((visit) => sameSource(visit.source, source))) return state;
  let index = state.index;
  const entries: DocumentVisit[] = [];
  state.entries.forEach((visit, position) => {
    if (!sameSource(visit.source, source)) entries.push(visit);
    else if (position <= state.index) index -= 1;
  });
  return {
    entries,
    index: entries.length === 0 ? -1 : Math.max(0, Math.min(index, entries.length - 1)),
  };
}

/** The visit one step back, or null at the start of the history. */
export function previousDocumentVisit(state: DocumentHistoryState): DocumentVisit | null {
  return state.index > 0 ? (state.entries[state.index - 1] ?? null) : null;
}

/** The visit one step forward, or null at the end of the history. */
export function nextDocumentVisit(state: DocumentHistoryState): DocumentVisit | null {
  return state.entries[state.index + 1] ?? null;
}

export function stepDocumentHistoryBack(state: DocumentHistoryState): DocumentHistoryState {
  return previousDocumentVisit(state) ? { ...state, index: state.index - 1 } : state;
}

export function stepDocumentHistoryForward(state: DocumentHistoryState): DocumentHistoryState {
  return nextDocumentVisit(state) ? { ...state, index: state.index + 1 } : state;
}
