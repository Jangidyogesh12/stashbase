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

interface ControlMessages {
  readonly invalid: string;
  readonly unavailable: string;
}

/** Control refusals the shared ladder cannot see: a format preparation
 *  does not handle, and a folder the
 *  daemon names in the body instead of in the status. Each carries the
 *  server's own sentence, because it names what to do next. */
function controlFailure(fallback: string) {
  return ({ response, serverMessage }: TransportFailure): PreparationError | null => {
    const failure = preparationFailureResponseSchema.safeParse(response.body);
    const cause = serverMessage === null ? undefined : { cause: new Error(serverMessage) };
    const message = serverMessage ?? fallback;
    if (response.status === 415) return new PreparationError('unsupported', message, cause);
    if (failure.data?.code === 'FOLDER_NOT_FOUND' || failure.data?.code === 'NO_FOLDER') {
      return new PreparationError('scope-lost', SCOPE_LOST, cause);
    }
    return null;
  };
}

function control(
  path: string,
  body: unknown,
  signal: AbortSignal,
  messages: ControlMessages,
): TransportRequest<'unsupported'> {
  return requestOptions({
    ...(body === undefined ? {} : { body }),
    error: PreparationError,
    failure: controlFailure(messages.unavailable),
    failureSchema: preparationFailureResponseSchema,
    messages: {
      'invalid-response': messages.invalid,
      'scope-lost': SCOPE_LOST,
      unavailable: messages.unavailable,
    },
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
        ...control('/api/files/prepare', sourceBody(source), signal, {
          invalid: 'Preparation returned an invalid response.',
          unavailable: 'Preparation could not start.',
        }),
        schema: preparationAcknowledgementSchema,
      });
    },
    async reprocess(source, signal) {
      const body = preparationSourceRequestSchema.parse({
        folder: source.folderPath,
        path: source.path,
      });
      const parsed = await request(client, {
        ...control('/api/files/reprocess', body, signal, {
          invalid: 'Reprocess returned an invalid response.',
          unavailable: 'Reprocess could not start. Try again.',
        }),
        schema: preparationReprocessResponseSchema,
      });
      return parsed.mode;
    },
    async cancel(source, signal) {
      const parsed = await request(client, {
        ...control('/api/files/cancel-preparation', sourceBody(source), signal, {
          invalid: 'Cancellation returned an invalid response.',
          unavailable: 'Preparation could not be cancelled.',
        }),
        schema: preparationCancelResponseSchema,
      });
      return parsed.cancelled;
    },
    async sync(folderPath, signal) {
      const query = new URLSearchParams({ folder: folderPath });
      const parsed = await request(client, {
        ...control(`/api/sync?${query}`, undefined, signal, {
          invalid: 'Sync returned an invalid response.',
          unavailable: 'The folder could not be refreshed.',
        }),
        schema: folderSyncResponseSchema,
      });
      return parsed.cancelled !== true;
    },
  };
}
