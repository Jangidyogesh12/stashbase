import {
  PreparationError,
  type PreparationControlPort,
} from '@/features/preparation/application/ports';
import {
  request,
  requestOptions,
  type TransportFailure,
  type TransportRequest,
} from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import { folderSyncResponseSchema } from '@/protocols/http/index-status';
import {
  preparationAcknowledgementSchema,
  preparationCancelResponseSchema,
  preparationFailureResponseSchema,
  preparationReprocessResponseSchema,
  preparationSourceRequestSchema,
} from '@/protocols/http/preparation';
import type { SourceReference } from '@/shared/domain/source-reference';

const SCOPE_LOST = 'This file is no longer available.';

/** Control refusals the shared ladder cannot see: a format preparation
 *  does not handle, and a folder the
 *  daemon names in the body instead of in the status. Each carries the
 *  server's own sentence, because it names what to do next. */
function controlFailure({ response, serverMessage }: TransportFailure): PreparationError | null {
  const failure = preparationFailureResponseSchema.safeParse(response.body);
  const cause = serverMessage === null ? undefined : { cause: new Error(serverMessage) };
  if (response.status === 415) {
    return new PreparationError('unsupported', 'Preparation does not handle this format.', cause);
  }
  if (failure.data?.code === 'FOLDER_NOT_FOUND' || failure.data?.code === 'NO_FOLDER') {
    return new PreparationError('scope-lost', SCOPE_LOST, cause);
  }
  return null;
}

function control(
  path: string,
  body: unknown,
  signal: AbortSignal,
): TransportRequest<'unsupported'> {
  return requestOptions({
    ...(body === undefined ? {} : { body }),
    error: PreparationError,
    failure: controlFailure,
    failureSchema: preparationFailureResponseSchema,
    method: 'POST',
    path,
    signal,
  });
}

function sourceBody(source: SourceReference) {
  return preparationSourceRequestSchema.parse({ folder: source.folderPath, path: source.path });
}

export function createPreparationControlAdapter(client: HttpClient): PreparationControlPort {
  return {
    async prepare(source, signal) {
      await request(client, {
        ...control('/api/files/prepare', sourceBody(source), signal),
        schema: preparationAcknowledgementSchema,
      });
    },
    async reprocess(source, signal) {
      const parsed = await request(client, {
        ...control('/api/files/reprocess', sourceBody(source), signal),
        schema: preparationReprocessResponseSchema,
      });
      return parsed.mode;
    },
    async cancel(source, signal) {
      const parsed = await request(client, {
        ...control('/api/files/cancel-preparation', sourceBody(source), signal),
        schema: preparationCancelResponseSchema,
      });
      return parsed.cancelled;
    },
    async sync(folderPath, signal) {
      const query = new URLSearchParams({ folder: folderPath });
      const parsed = await request(client, {
        ...control(`/api/sync?${query}`, undefined, signal),
        schema: folderSyncResponseSchema,
      });
      return parsed.cancelled !== true;
    },
  };
}
