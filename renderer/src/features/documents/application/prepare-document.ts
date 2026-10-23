import type { QueryClient } from '@tanstack/react-query';

import type { DocumentScope } from '@/features/documents/domain/document';
import {
  documentTextFormat,
  documentViewerFormat,
} from '@/features/documents/domain/document-format';

import {
  DELIMITED_TABLE_MESSAGES,
  documentFailure,
  DOCUMENT_ASSET_MESSAGES,
  DOCUMENT_SOURCE_MESSAGES,
  GENERIC_PREVIEW_MESSAGES,
} from './failure-messages';
import type {
  DelimitedTablePort,
  DocumentAssetPort,
  DocumentSourcePort,
  GenericFilePreviewPort,
} from './ports';
import {
  delimitedTableHeadQuery,
  documentAssetQuery,
  documentSourceQuery,
  genericFilePreviewQuery,
} from './queries';

/** Resolve a candidate before a usable preview gives up its slot. */
export async function prepareDocument(
  client: QueryClient,
  ports: {
    source: DocumentSourcePort;
    asset: DocumentAssetPort;
    genericPreview: GenericFilePreviewPort;
    table: DelimitedTablePort;
  },
  scope: DocumentScope,
): Promise<string | null> {
  const format = documentViewerFormat(scope.source.path);
  // A table opens on its first page, which a file too large to edit as text
  // still has; its text loads only when the reader asks for the source.
  if (format === 'csv') {
    try {
      await client.fetchQuery(delimitedTableHeadQuery(ports.table, scope));
      return null;
    } catch (error) {
      return documentFailure(error, 'DelimitedTableError', DELIMITED_TABLE_MESSAGES).message;
    }
  }
  try {
    if (documentTextFormat(scope.source.path))
      await client.fetchQuery(documentSourceQuery(ports.source, scope));
    else if (format === 'generic')
      await client.fetchQuery(genericFilePreviewQuery(ports.genericPreview, scope));
    else await client.fetchQuery(documentAssetQuery(ports.asset, scope));
    return null;
  } catch (error) {
    if (documentTextFormat(scope.source.path))
      return documentFailure(error, 'DocumentSourceError', DOCUMENT_SOURCE_MESSAGES).message;
    return format === 'generic'
      ? documentFailure(error, 'GenericFilePreviewError', GENERIC_PREVIEW_MESSAGES).message
      : documentFailure(error, 'DocumentAssetError', DOCUMENT_ASSET_MESSAGES).message;
  }
}
