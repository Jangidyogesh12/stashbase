/** The operations one open document exposes to tabs and editor surfaces. */
import type { StoreApi } from 'zustand/vanilla';

import type {
  DocumentConflictResolution,
  DocumentScope,
  DocumentState,
  DocumentTextSource,
  JsonDocumentSession,
  MarkdownViewMode,
} from '@/features/documents/domain/document';
import type { DocumentViewerFormat } from '@/features/documents/domain/document-format';
import type { RevisionRefusal, RevisionReview } from '@/features/documents/domain/revision';
import type { TableViewMode } from '@/features/documents/domain/table';
import type { SourceReference } from '@/shared/domain/source-reference';
import type { CapturedScope } from '@/shared/runtime/scope-guard';

import type { DocumentQueryScope, DocumentSourcePort } from './ports';

/** Capture before an await; a later completion must still own this scope. */
export type DocumentOperationScope = CapturedScope<DocumentScope>;

export interface DocumentRuntime {
  readingPosition: { top: number; left: number } | null;
  readonly scope: DocumentScope;
  readonly signal: AbortSignal;
  readonly store: StoreApi<DocumentState>;
  /** Runs a completion only while its captured scope still owns the document. */
  accept(captured: DocumentOperationScope, completion: () => void): boolean;
  capture(): DocumentOperationScope;
  change(value: string): void;
  /** Lets an editor surface hold an edit until typing pauses: serializing a
   *  long document on every keystroke is what made typing lag. `flush` must
   *  publish the held edit through `change` synchronously. Answers a release. */
  holdEdits(flush: () => void): () => void;
  /** Publishes an edit a surface is still holding. Everything that reads the
   *  editor text calls this first, so held work is never missed. */
  settleEdits(): void;
  dispose(): void;
  finishMerge(api: DocumentSourcePort): Promise<boolean>;
  publishRevisionCount(reviewId: string, pending: number): void;
  reconcile(source: DocumentTextSource): void;
  rebind(
    source: SourceReference,
    createQueries: (scope: DocumentScope) => DocumentQueryScope,
  ): void;
  setMutationPending(pending: boolean): void;
  retireOperations(): void;
  resolveConflict(
    api: DocumentSourcePort,
    resolution: DocumentConflictResolution,
  ): Promise<boolean>;
  restore(api: DocumentSourcePort): Promise<boolean>;
  save(api: DocumentSourcePort): Promise<boolean>;
  startRevision(review: RevisionReview, currentBody: string): RevisionRefusal | null;
  setJsonSession(patch: Partial<JsonDocumentSession>): void;
  setMarkdownMode(mode: MarkdownViewMode): void;
  setPdfPage(page: number): void;
  setTableMode(mode: TableViewMode): void;
}

export interface DocumentUsageEvent {
  event: 'document_engaged';
  activity: 'read' | 'edit';
  format: DocumentViewerFormat;
}

export interface DocumentRuntimeOptions {
  recordUsage?: ((event: DocumentUsageEvent) => void) | undefined;
  api?: DocumentSourcePort;
  activeFolderPath: string;
  generation: number;
  id: string;
  queries: DocumentQueryScope;
  source: SourceReference;
}
