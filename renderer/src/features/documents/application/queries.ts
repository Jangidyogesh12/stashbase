/** The query keys and query options every open document reads through: its
 *  text, asset, previews, and table pages, all scoped to the tab's identity so
 *  closing or rebinding a tab retires exactly its own reads. */
import type { QueryClient } from '@tanstack/react-query';

import type { DocumentScope, DocumentTextSource } from '@/features/documents/domain/document';
import type { DelimitedTablePage } from '@/features/documents/domain/table';
import type { SourceReference } from '@/shared/domain/source-reference';

import type {
  DelimitedTablePort,
  DocumentAssetPort,
  DocumentQueryScope,
  DocumentSourcePort,
  DocxDocumentAsset,
  DocxPreviewPort,
  GenericFilePreviewPort,
} from './ports';

export const documentQueryKeys = {
  all: ['documents'] as const,
  scope: (scope: DocumentScope) =>
    [
      ...documentQueryKeys.all,
      scope.source.folderPath,
      scope.source.path,
      scope.id,
      scope.generation,
    ] as const,
  source: (scope: DocumentScope) => [...documentQueryKeys.scope(scope), 'source'] as const,
  genericPreview: (scope: DocumentScope) =>
    [...documentQueryKeys.scope(scope), 'generic-preview'] as const,
  asset: (scope: DocumentScope) => [...documentQueryKeys.scope(scope), 'asset'] as const,
  /** The first page, which also carries the table's shape and version. Later
   *  pages are keyed by that version, so a changed file reads them again. */
  tableHead: (scope: DocumentScope) => [...documentQueryKeys.scope(scope), 'table'] as const,
  tablePage: (scope: DocumentScope, version: string, page: number) =>
    [...documentQueryKeys.scope(scope), 'table', version, page] as const,
  docxPreview: (scope: DocumentScope, version: string) =>
    [...documentQueryKeys.scope(scope), 'docx-preview', version] as const,
};

/** Refetches the open documents behind sources something else wrote to.
 *  A clean editor takes the newer disk text; a dirty one keeps its draft and
 *  meets the versioned conflict path on its next save. */
export function refreshDocumentSources(
  queryClient: QueryClient,
  sources: readonly SourceReference[],
): void {
  if (sources.length === 0) return;
  const wanted = new Set(sources.map((source) => `${source.folderPath}\0${source.path}`));
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const [root, folderPath, path] = query.queryKey;
      return (
        root === documentQueryKeys.all[0] &&
        typeof folderPath === 'string' &&
        typeof path === 'string' &&
        wanted.has(`${folderPath}\0${path}`)
      );
    },
  });
}

export function createDocumentQueryScope(
  queryClient: QueryClient,
  scope: DocumentScope,
): DocumentQueryScope {
  const scopeKey = documentQueryKeys.scope(scope);
  return {
    cancel: () => queryClient.cancelQueries({ queryKey: scopeKey }),
    remove: () => queryClient.removeQueries({ queryKey: scopeKey }),
    replaceSource: (source: DocumentTextSource) => {
      const queryKey = documentQueryKeys.source(scope);
      // A read started before this accepted write must not publish older text
      // after the editor becomes clean. Cancellation retires it synchronously.
      void queryClient.cancelQueries({ exact: true, queryKey });
      queryClient.setQueryData(queryKey, source);
    },
  };
}

export function docxPreviewQuery(
  api: DocxPreviewPort,
  scope: DocumentScope,
  resource: DocxDocumentAsset,
) {
  return {
    queryFn: ({ signal }: { signal: AbortSignal }) => api.load(resource, signal),
    queryKey: documentQueryKeys.docxPreview(scope, resource.version),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  } as const;
}

export function documentAssetQuery(api: DocumentAssetPort, scope: DocumentScope) {
  return {
    queryFn: ({ signal }: { signal: AbortSignal }) => api.load(scope.source, signal),
    queryKey: documentQueryKeys.asset(scope),
    retry: false,
    staleTime: 0,
  } as const;
}

export function documentSourceQuery(api: DocumentSourcePort, scope: DocumentScope) {
  return {
    queryFn: ({ signal }: { signal: AbortSignal }) => api.load(scope.source, signal),
    queryKey: documentQueryKeys.source(scope),
    retry: false,
    staleTime: 0,
  } as const;
}

/** Rows per table page: a screenful many times over, and well under the
 *  host's own per-response bound. */
export const TABLE_PAGE_ROWS = 200;

/** One whole page. The host returns fewer rows when they would overflow one
 *  response, so the rest are asked for until the page is complete. */
async function loadTablePage(
  api: DelimitedTablePort,
  source: SourceReference,
  start: number,
  signal: AbortSignal,
): Promise<DelimitedTablePage> {
  const first = await api.load(source, { count: TABLE_PAGE_ROWS, start }, signal);
  if (first.kind !== 'table') return first;
  let rows = first.rows;
  while (rows.length < TABLE_PAGE_ROWS && first.start + rows.length < first.rowCount) {
    const next = await api.load(
      source,
      { count: TABLE_PAGE_ROWS - rows.length, start: first.start + rows.length },
      signal,
    );
    // A newer file answers for itself; the caller reads the new shape first.
    if (next.kind !== 'table' || next.version !== first.version) return next;
    if (next.rows.length === 0) break;
    rows = rows.concat(next.rows);
  }
  return rows === first.rows ? first : { ...first, rows };
}

export function delimitedTableHeadQuery(api: DelimitedTablePort, scope: DocumentScope) {
  return {
    queryFn: ({ signal }: { signal: AbortSignal }) => loadTablePage(api, scope.source, 0, signal),
    queryKey: documentQueryKeys.tableHead(scope),
    retry: false,
    staleTime: 0,
  } as const;
}

export function delimitedTablePageQuery(
  api: DelimitedTablePort,
  scope: DocumentScope,
  version: string,
  page: number,
) {
  return {
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      loadTablePage(api, scope.source, page * TABLE_PAGE_ROWS, signal),
    queryKey: documentQueryKeys.tablePage(scope, version, page),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  } as const;
}

export function genericFilePreviewQuery(api: GenericFilePreviewPort, scope: DocumentScope) {
  return {
    queryFn: ({ signal }: { signal: AbortSignal }) => api.load(scope.source, signal),
    queryKey: documentQueryKeys.genericPreview(scope),
    retry: false,
    staleTime: 0,
  } as const;
}
