/**
 * The one place the embedder wire shapes are spoken.
 *
 * The transport answers every embedder call with BYOK source state only. The
 * mappers below translate that wire shape, so nothing above this adapter
 * imports a protocol module.
 */

import { EmbedderError, type EmbedderPort } from '@/features/settings/application/embedder-port';
import type { EmbedderKeySave, EmbedderState } from '@/features/settings/domain/embedder';
import {
  request,
  requestOptions,
  type TransportCall,
  type TransportFailure,
  type TransportRequest,
} from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import {
  embedderFailureSchema,
  embedderKeyRequestSchema,
  embedderKeySaveResponseSchema,
  embedderStateSchema,
  type EmbedderKeySaveResponseWire,
  type EmbedderStateWire,
} from '@/protocols/http/embedder';

function toEmbedderState(wire: EmbedderStateWire): EmbedderState {
  return {
    hasKey: wire.hasKey,
    model: wire.model,
    provider: wire.provider,
  };
}

function toKeySave(wire: EmbedderKeySaveResponseWire): EmbedderKeySave {
  return { warning: wire.warning ?? null };
}

/** The embedder routes refuse what the user can fix — a key the provider will
 *  not accept — with a 4xx and their own sentence. Everything else is an
 *  unreachable capability. */
function rejection({ response, serverMessage }: TransportFailure): EmbedderError | null {
  if (response.status < 400 || response.status >= 500) return null;
  return new EmbedderError(
    'rejected',
    'The embedder settings refused the request.',
    serverMessage === null ? undefined : { cause: new Error(serverMessage) },
  );
}

function call(
  path: string,
  signal: AbortSignal,
  extra?: { body?: unknown; method?: TransportCall['method'] },
): TransportRequest<'rejected'> {
  return requestOptions({
    ...extra,
    error: EmbedderError,
    failure: rejection,
    failureSchema: embedderFailureSchema,
    path,
    signal,
  });
}

export function createEmbedderAdapter(client: HttpClient): EmbedderPort {
  return {
    async load(signal) {
      return toEmbedderState(
        await request(client, {
          ...call('/api/embedder', signal),
          schema: embedderStateSchema,
        }),
      );
    },
    async removeKey(signal) {
      return toEmbedderState(
        await request(client, {
          ...call('/api/embedder/key', signal, {
            method: 'DELETE',
          }),
          schema: embedderStateSchema,
        }),
      );
    },
    async saveKey(provider, key, signal) {
      return toKeySave(
        await request(client, {
          ...call('/api/embedder/key', signal, {
            body: embedderKeyRequestSchema.parse({ key, provider }),
            method: 'PUT',
          }),
          schema: embedderKeySaveResponseSchema,
        }),
      );
    },
  };
}
