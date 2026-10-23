/**
 * The HTTP adapter for reading and writing a document's text. Refusals are
 * classified onto the documents failure ladders here — a version conflict, a
 * lost folder grant, an undecodable encoding — so nothing above this seam
 * inspects a status code.
 */
import {
  DocumentSaveError,
  DocumentSourceError,
  type DocumentSourcePort,
} from '@/features/documents/application/ports';
import { documentTextFormat } from '@/features/documents/domain/document-format';
import { request, type TransportFailure, type TransportRequest } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import {
  documentTextSaveFailureSchema,
  documentTextOverwriteRequestSchema,
  documentTextSaveRequestSchema,
  documentTextSaveResponseSchema,
  documentTextSourceFailureSchema,
  documentTextSourceRequestSchema,
  documentTextSourceResponseSchema,
} from '@/protocols/http/files';
import { externalFileToken } from '@/shared/domain/external-source';
import type { SourceReference } from '@/shared/domain/source-reference';
import { encodePathSegments } from '@/shared/utils/file-path';

import { externalFileRoute } from './external-file-api';

const READ_SCOPE_LOST = "The document's project is no longer available in this window.";
const SAVE_SCOPE_LOST = "The document's project is no longer active in this window.";

function cause(serverMessage: string | null): ErrorOptions | undefined {
  return serverMessage === null ? undefined : { cause: new Error(serverMessage) };
}

/** A save meets one refusal the shared ladder cannot see: the file changed
 *  under the editor, which is recoverable and carries the version on disk. */
function saveFailure({ response, serverMessage }: TransportFailure): DocumentSaveError | null {
  const failure = documentTextSaveFailureSchema.safeParse(response.body);
  if (response.status === 409 && failure.success && failure.data.code === 'FILE_CHANGED') {
    return new DocumentSaveError(
      'conflict',
      'The file changed on disk. Your unsaved changes are still available.',
      { ...cause(serverMessage), currentVersion: failure.data.currentVersion },
    );
  }
  if (
    response.status === 409 ||
    (failure.success &&
      (failure.data.code === 'FOLDER_CHANGED' ||
        failure.data.code === 'FOLDER_UNAVAILABLE' ||
        failure.data.code === 'NO_FOLDER'))
  ) {
    return new DocumentSaveError('scope-lost', SAVE_SCOPE_LOST, cause(serverMessage));
  }
  if (response.status === 404)
    return new DocumentSaveError('missing', 'The source file is missing.', cause(serverMessage));
  return null;
}

/** The read route names a folder that went away in the body as well as in
 *  the status. */
function readScopeFailure({
  response,
  serverMessage,
}: TransportFailure): DocumentSourceError | null {
  const failure = documentTextSourceFailureSchema.safeParse(response.body);
  return failure.success &&
    (failure.data.code === 'FOLDER_UNAVAILABLE' || failure.data.code === 'NO_FOLDER')
    ? new DocumentSourceError('scope-lost', READ_SCOPE_LOST, cause(serverMessage))
    : response.status === 404
      ? new DocumentSourceError('missing', 'The source file is missing.', cause(serverMessage))
      : null;
}

function saveRequest(
  path: string,
  body: unknown,
  signal: AbortSignal,
): TransportRequest<'conflict' | 'missing'> {
  return {
    body,
    error: DocumentSaveError,
    failure: saveFailure,
    failureSchema: documentTextSaveFailureSchema,
    method: 'PUT',
    path,
    signal,
  };
}

type SaveResponse = ReturnType<typeof documentTextSaveResponseSchema.parse>;

/** A saved document must come back as the same file in the same format the
 *  editor sent, or the response belongs to something else. */
function savedDocument(source: SourceReference, body: SaveResponse) {
  const expectedFormat = documentTextFormat(source.path);
  if (expectedFormat === null || body.name !== source.path || body.format !== expectedFormat) {
    throw new DocumentSaveError(
      'invalid-response',
      'The document save returned an invalid response.',
    );
  }
  return {
    content: body.content,
    format: expectedFormat,
    version: body.version,
    ...(body.indexWarning ? { indexWarning: body.indexWarning } : {}),
  };
}

function documentPath(folderPath: string, entryPath: string): string {
  const query = new URLSearchParams({ folder: folderPath });
  return `/api/files/${encodePathSegments(entryPath)}?${query}`;
}

/** An external file reads through its grant; a project file by its folder. */
function textSourcePath(source: SourceReference): string {
  const token = externalFileToken(source);
  if (token) return externalFileRoute(token, '/text');
  const identity = documentTextSourceRequestSchema.safeParse(source);
  if (!identity.success) {
    throw new DocumentSourceError('unavailable', 'The document identity is invalid.');
  }
  return documentPath(identity.data.folderPath, identity.data.path);
}

/** An external file saves through its grant; a project file by its folder. */
function savePath(source: SourceReference, identity: { folderPath: string; path: string }): string {
  const token = externalFileToken(source);
  return token
    ? externalFileRoute(token, '/text')
    : documentPath(identity.folderPath, identity.path);
}

export function createDocumentSourceAdapter(client: HttpClient): DocumentSourcePort {
  return {
    async load(source, signal) {
      if (documentTextFormat(source.path) === null) {
        throw new DocumentSourceError(
          'unavailable',
          'This document format is not available in the text source loader.',
        );
      }
      const body = await request(client, {
        error: DocumentSourceError,
        failure: readScopeFailure,
        failureSchema: documentTextSourceFailureSchema,
        path: textSourcePath(source),
        schema: documentTextSourceResponseSchema,
        signal,
      });
      const expectedFormat = documentTextFormat(source.path);
      if (expectedFormat === null || body.name !== source.path || body.format !== expectedFormat) {
        throw new DocumentSourceError(
          'invalid-response',
          'The document returned an invalid response.',
        );
      }
      if ('error' in body) {
        throw new DocumentSourceError(
          'unsupported-encoding',
          'This text file is not valid UTF-8. It remains unchanged and read-only.',
          { cause: new Error(body.error.message) },
        );
      }
      return { content: body.content, format: expectedFormat, version: body.version };
    },
    async overwrite(source, input, signal) {
      const overwrite = documentTextOverwriteRequestSchema.safeParse({
        ...input,
        folderPath: source.folderPath,
        overwrite: true,
        path: source.path,
      });
      if (!overwrite.success || documentTextFormat(source.path) === null) {
        throw new DocumentSaveError('unavailable', 'The document overwrite request is invalid.');
      }
      const { data } = overwrite;
      return savedDocument(
        source,
        await request(client, {
          ...saveRequest(
            savePath(source, data),
            { content: data.content, overwrite: true },
            signal,
          ),
          schema: documentTextSaveResponseSchema,
        }),
      );
    },
    async save(source, input, signal) {
      const save = documentTextSaveRequestSchema.safeParse({
        ...input,
        folderPath: source.folderPath,
        path: source.path,
      });
      if (!save.success || documentTextFormat(source.path) === null) {
        throw new DocumentSaveError('unavailable', 'The document save request is invalid.');
      }
      const { data } = save;
      return savedDocument(
        source,
        await request(client, {
          ...saveRequest(
            savePath(source, data),
            { baseVersion: data.baseVersion, content: data.content },
            signal,
          ),
          schema: documentTextSaveResponseSchema,
        }),
      );
    },
  };
}
