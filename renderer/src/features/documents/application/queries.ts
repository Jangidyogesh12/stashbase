import type { QueryClient } from '@tanstack/react-query';

import type { DocumentScope, DocumentTextSource } from '@/features/documents/domain/document';
import type { SourceReference } from '@/shared/domain/source-reference';

import type {
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

export function genericFilePreviewQuery(api: GenericFilePreviewPort, scope: DocumentScope) {
  return {
    queryFn: ({ signal }: { signal: AbortSignal }) => api.load(scope.source, signal),
    queryKey: documentQueryKeys.genericPreview(scope),
    retry: false,
    staleTime: 0,
  } as const;
}
