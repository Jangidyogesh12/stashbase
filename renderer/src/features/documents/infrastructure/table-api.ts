import {
  DelimitedTableError,
  type DelimitedTablePort,
} from '@/features/documents/application/ports';
import type { DelimitedTablePage } from '@/features/documents/domain/table';
import { request, type TransportFailure } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import {
  delimitedTableResponseSchema,
  documentTextSourceFailureSchema,
  documentTextSourceRequestSchema,
} from '@/protocols/http/files';
import { externalFileToken } from '@/shared/domain/external-source';
import type { SourceReference } from '@/shared/domain/source-reference';
import { encodePathSegments } from '@/shared/utils/file-path';

import { externalFileRoute } from './external-file-api';

function tableFailure({ response, serverMessage }: TransportFailure): DelimitedTableError | null {
  const failure = documentTextSourceFailureSchema.safeParse(response.body);
  const cause = serverMessage === null ? undefined : { cause: new Error(serverMessage) };
  if (
    failure.success &&
    (failure.data.code === 'FOLDER_UNAVAILABLE' || failure.data.code === 'NO_FOLDER')
  ) {
    return new DelimitedTableError(
      'scope-lost',
      "The file's project is no longer available in this window.",
      cause,
    );
  }
  return response.status === 404
    ? new DelimitedTableError('missing', 'The source file is missing.', cause)
    : null;
}

/** An external file reads through its grant; a project file by its folder. */
function tablePath(source: SourceReference, page: { count: number; start: number }): string {
  const range = new URLSearchParams({ count: String(page.count), start: String(page.start) });
  const token = externalFileToken(source);
  if (token) return `${externalFileRoute(token, '/table')}?${range}`;
  const identity = documentTextSourceRequestSchema.safeParse(source);
  if (!identity.success) {
    throw new DelimitedTableError('unavailable', 'The file identity is invalid.');
  }
  range.set('folder', identity.data.folderPath);
  return `/api/file-table/${encodePathSegments(identity.data.path)}?${range}`;
}

export function createDelimitedTableAdapter(client: HttpClient): DelimitedTablePort {
  return {
    async load(source, page, signal): Promise<DelimitedTablePage> {
      const body = await request(client, {
        error: DelimitedTableError,
        failure: tableFailure,
        failureSchema: documentTextSourceFailureSchema,
        path: tablePath(source, page),
        schema: delimitedTableResponseSchema,
        signal,
      });
      if (body.name !== source.path) {
        throw new DelimitedTableError(
          'invalid-response',
          'The table returned an invalid response.',
        );
      }
      return body;
    },
  };
}
