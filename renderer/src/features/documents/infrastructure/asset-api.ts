import { DocumentAssetError, type DocumentAssetPort } from '@/features/documents/application/ports';
import { documentViewerFormat } from '@/features/documents/domain/document-format';
import { send } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import { documentTextSourceRequestSchema } from '@/protocols/http/files';
import { encodePathSegments } from '@/shared/utils/file-path';

function assetPath(
  prefix: '/asset' | '/asset-derived',
  folderPath: string,
  entryPath: string,
): string {
  const folder = encodeURIComponent(encodeURIComponent(folderPath));
  return `${prefix}/__folder/${folder}/${encodePathSegments(entryPath)}`;
}

export function createDocumentAssetAdapter(
  client: HttpClient,
  serverOrigin: string,
): DocumentAssetPort {
  const origin = new URL(serverOrigin);
  return {
    async load(source, signal) {
      const request = documentTextSourceRequestSchema.safeParse(source);
      if (!request.success) {
        throw new DocumentAssetError('unavailable', 'The file identity is invalid.');
      }
      const query = new URLSearchParams({ folder: request.data.folderPath });
      // The version lives in a response header, so the success body is the
      // adapter's own business and only the failure ladder is shared.
      const response = await send(client, {
        error: DocumentAssetError,
        failure: ({ response: refused }) =>
          refused.status === 404
            ? new DocumentAssetError('missing', 'The source file is missing.')
            : null,
        method: 'HEAD',
        path: `/api/files/${encodePathSegments(request.data.path)}?${query}`,
        signal,
      });
      const version = response.headers?.['x-stashbase-file-version'];
      if (!version) {
        throw new DocumentAssetError(
          'invalid-response',
          'The file preview returned an invalid version.',
        );
      }
      const url = new URL(assetPath('/asset', request.data.folderPath, request.data.path), origin);
      url.searchParams.set('v', version);
      const format = documentViewerFormat(request.data.path);
      if (format !== 'docx' && format !== 'audio') {
        return { kind: 'source', url: url.href, version };
      }
      if (format === 'audio') return { kind: 'media', url: url.href, version };
      const fallbackUrl = new URL(
        assetPath('/asset-derived', request.data.folderPath, request.data.path),
        origin,
      );
      fallbackUrl.searchParams.set('v', version);
      return { fallbackUrl: fallbackUrl.href, kind: 'docx', url: url.href, version };
    },
  };
}
