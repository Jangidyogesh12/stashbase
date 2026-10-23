import {
  GenericFilePreviewError,
  type GenericFilePreviewPort,
} from '@/features/documents/application/ports';
import type { GenericFilePreview } from '@/features/documents/domain/generic-preview';
import { request, type TransportFailure } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import {
  documentTextSourceFailureSchema,
  documentTextSourceRequestSchema,
  genericFilePreviewResponseSchema,
} from '@/protocols/http/files';
import { externalFileToken } from '@/shared/domain/external-source';
import type { SourceReference } from '@/shared/domain/source-reference';
import { encodePathSegments } from '@/shared/utils/file-path';

import { externalFileRoute } from './external-file-api';

const SCOPE_LOST = "The file's project is no longer available in this window.";

/** Two refusals the shared ladder cannot see: a format that belongs to a
 *  dedicated viewer, and a folder the server names in the body. */
function previewFailure({
  response,
  serverMessage,
}: TransportFailure): GenericFilePreviewError | null {
  const failure = documentTextSourceFailureSchema.safeParse(response.body);
  const cause = serverMessage === null ? undefined : { cause: new Error(serverMessage) };
  if (response.status === 415) {
    return new GenericFilePreviewError(
      'not-generic',
      'This file belongs to a format-specific viewer.',
      cause,
    );
  }
  return failure.success &&
    (failure.data.code === 'FOLDER_UNAVAILABLE' || failure.data.code === 'NO_FOLDER')
    ? new GenericFilePreviewError('scope-lost', SCOPE_LOST, cause)
    : response.status === 404
      ? new GenericFilePreviewError('missing', 'The source file is missing.', cause)
      : null;
}

function mapPreview(body: PreviewResponse, expectedName: string): GenericFilePreview {
  if (body.name !== expectedName) {
    throw new GenericFilePreviewError(
      'invalid-response',
      'The file preview returned an invalid response.',
    );
  }
  if (body.kind === 'text') {
    return {
      content: body.content,
      kind: 'text',
      name: body.name,
      size: body.size,
      ...(body.version ? { version: body.version } : {}),
    };
  }
  return {
    kind: body.kind,
    name: body.name,
    ...(body.message ? { message: body.message } : {}),
    ...(body.size === undefined ? {} : { size: body.size }),
  };
}

type PreviewResponse = ReturnType<typeof genericFilePreviewResponseSchema.parse>;

/** An external file previews through its grant; a project file by its folder. */
function previewPath(source: SourceReference): string {
  const token = externalFileToken(source);
  if (token) return externalFileRoute(token, '/preview');
  const identity = documentTextSourceRequestSchema.safeParse(source);
  if (!identity.success) {
    throw new GenericFilePreviewError('unavailable', 'The file identity is invalid.');
  }
  const query = new URLSearchParams({ folder: identity.data.folderPath });
  return `/api/file-preview/${encodePathSegments(identity.data.path)}?${query}`;
}

export function createGenericFilePreviewAdapter(client: HttpClient): GenericFilePreviewPort {
  return {
    async load(source, signal) {
      return mapPreview(
        await request(client, {
          error: GenericFilePreviewError,
          failure: previewFailure,
          failureSchema: documentTextSourceFailureSchema,
          path: previewPath(source),
          schema: genericFilePreviewResponseSchema,
          signal,
        }),
        source.path,
      );
    },
  };
}
