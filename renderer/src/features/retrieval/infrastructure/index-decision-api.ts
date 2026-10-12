import { IndexDecisionError, type IndexDecisionPort } from '@/features/retrieval/application/ports';
import { request, send, type TransportRequest } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import {
  indexStatusAcknowledgementSchema,
  indexStatusFailureSchema,
} from '@/protocols/http/index-status';

/** Every decision route is a folder-explicit POST that reports its own
 *  sentence when the daemon refuses it. */
function decision(path: string, body: unknown, signal: AbortSignal): TransportRequest {
  return {
    ...(body === undefined ? {} : { body }),
    error: IndexDecisionError,
    failureSchema: indexStatusFailureSchema,
    method: 'POST',
    path,
    signal,
  };
}

export function createIndexDecisionAdapter(client: HttpClient): IndexDecisionPort {
  return {
    async dismissWarning(folderPath, signal) {
      await request(client, {
        ...decision('/api/index-warning/dismiss', { folder: folderPath }, signal),
        schema: indexStatusAcknowledgementSchema,
      });
    },
    async resync(folderPath, signal) {
      const query = new URLSearchParams({ folder: folderPath });
      await send(client, decision(`/api/sync?${query}`, undefined, signal));
    },
  };
}
