/**
 * The Workbench visibility transport.
 *
 * The route answers every read and write with the state it actually applied,
 * so both sides of this adapter return that answer rather than the value that
 * was asked for. A window therefore cannot end up showing rows one way and a
 * menu the other.
 */
import { FilesError, type WorkspacePreferencesPort } from '@/features/workspace/application/ports';
import { request, requestOptions, type TransportRequest } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import {
  workspacePreferencesRequestSchema,
  workspacePreferencesSchema,
} from '@/protocols/http/workspace-preferences';

/** A refused preference is the reader's own request coming back, not a lost
 *  capability, so it reads as the files ladder's `rejected`. */
function preferences(
  signal: AbortSignal,
): TransportRequest<'conflict' | 'rejected' | 'outcome-unknown'> {
  return requestOptions({
    error: FilesError,
    invalidRequest: 'rejected',
    path: '/api/workspace-preferences',
    signal,
  });
}

export function createWorkspacePreferencesAdapter(client: HttpClient): WorkspacePreferencesPort {
  return {
    async load(signal) {
      const parsed = await request(client, {
        ...preferences(signal),
        schema: workspacePreferencesSchema,
      });
      return parsed.showHiddenFiles;
    },
    async setShowHiddenFiles(next, signal) {
      const parsed = await request(client, {
        ...preferences(signal),
        body: workspacePreferencesRequestSchema.parse({ showHiddenFiles: next }),
        method: 'PUT',
        schema: workspacePreferencesSchema,
      });
      return parsed.showHiddenFiles;
    },
  };
}
