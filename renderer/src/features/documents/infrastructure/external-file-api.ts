/**
 * External files: the desktop bridge resolves a dropped `File` to a read
 * grant, and every later read names only the grant's token. Nothing here
 * accepts a path, so the renderer cannot ask the server for an arbitrary file.
 */
import type { ExternalFileOpening, ExternalFilePort } from '@/features/documents/application/ports';
import { DocumentAssetError } from '@/features/documents/application/ports';
import type { ExternalFilesBridge } from '@/platform/electron/external-files';
import { send } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import { externalFilesOpenResponseSchema } from '@/protocols/electron/external-files';
import { externalFileToken, externalSource } from '@/shared/domain/external-source';
import type { SourceReference } from '@/shared/domain/source-reference';
import { basePathName } from '@/shared/utils/file-path';

export function externalFileRoute(token: string, leaf = ''): string {
  return `/api/external-files/${encodeURIComponent(token)}${leaf}`;
}

/** The browser-loaded bytes of a granted PDF or image. The trailing name
 *  only labels the URL; the server reads the grant's own file. */
export function externalAssetPath(token: string, source: SourceReference): string {
  return `/asset/__external/${encodeURIComponent(token)}/${encodeURIComponent(basePathName(source.path))}`;
}

export function createExternalFileAdapter(
  client: HttpClient,
  bridge: ExternalFilesBridge | undefined,
): ExternalFilePort {
  return {
    available: bridge !== undefined,
    async open(file): Promise<ExternalFileOpening> {
      const refused = { kind: 'refused', name: file.name, reason: 'unavailable' } as const;
      if (!bridge) return refused;
      const response = externalFilesOpenResponseSchema.safeParse(await bridge.open(file));
      if (!response.success || !response.data.ok) return refused;
      const { result } = response.data;
      switch (result.kind) {
        case 'external':
          return { kind: 'external', source: externalSource(result.token, result.path) };
        case 'project':
          return {
            kind: 'project',
            path: result.path,
            ...(result.folderPath ? { folderPath: result.folderPath } : {}),
          };
        case 'refused':
          return { kind: 'refused', name: result.name, reason: result.reason };
      }
    },
    async reveal(source, signal) {
      const token = externalFileToken(source);
      if (!token) throw new DocumentAssetError('unavailable', 'The file identity is invalid.');
      await send(client, {
        error: DocumentAssetError,
        failure: ({ response }) =>
          response.status === 404
            ? new DocumentAssetError('missing', 'The source file is missing.')
            : null,
        method: 'POST',
        path: externalFileRoute(token, '/reveal'),
        signal,
      });
    },
    async revoke(source) {
      const token = externalFileToken(source);
      if (!token) return;
      try {
        await send(client, {
          error: DocumentAssetError,
          method: 'DELETE',
          path: externalFileRoute(token),
        });
      } catch {
        // The server drops every grant when the project changes or the
        // window closes, so a lost revoke cannot outlive the window.
      }
    },
  };
}
