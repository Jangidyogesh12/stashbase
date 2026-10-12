/**
 * The HTTP adapter for what a Markdown file held before an Agent turn. The
 * host keeps that text for a while after the turn, and the read does not
 * consume it, so the reader can review the same turn twice.
 */
import {
  DocumentTurnChangesError,
  type DocumentTurnChangesPort,
} from '@/features/documents/application/ports';
import { request } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import { turnChangeResponseSchema } from '@/protocols/http/turn-changes';

const EXPIRED_CODE = 'TURN_CHANGE_EXPIRED';

function expiredBody(body: unknown): boolean {
  return (
    typeof body === 'object' && body !== null && (body as { code?: unknown }).code === EXPIRED_CODE
  );
}

export function createDocumentTurnChangesAdapter(client: HttpClient): DocumentTurnChangesPort {
  return {
    async load({ source, turnId }, signal) {
      const path = `${source.folderPath.replace(/\/+$/u, '')}/${source.path}`;
      const query = new URLSearchParams({ folder: source.folderPath, turn: turnId, path });
      const body = await request(client, {
        error: DocumentTurnChangesError,
        // A folder the host no longer knows is also a 404, so only the host's
        // own expiry code means the turn is gone.
        failure: ({ response }) =>
          response.status === 404 && expiredBody(response.body)
            ? new DocumentTurnChangesError('expired', 'That turn is no longer available.')
            : null,
        path: `/api/turn-changes?${query}`,
        schema: turnChangeResponseSchema,
        signal,
      });
      return { afterVersion: body.afterVersion, before: body.before, source, turnId };
    },
  };
}
