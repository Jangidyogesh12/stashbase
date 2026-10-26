/**
 * The files transport. Beyond the shared ladder these routes can refuse a
 * mutation two ways the listing never meets — a name already taken and a name
 * the server rejects — and they report a folder that moved under an open
 * window as a 409, so scope loss is read from the body as well as the status.
 */
import { FilesError, type FilesPort } from '@/features/workspace/application/ports';
import { joinTreePath, type WorkspaceListing } from '@/features/workspace/domain/tree';
import {
  request,
  type ResponseSchema,
  type TransportFailure,
  type TransportRequest,
} from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import {
  workspaceCreateEntryRequestSchema,
  workspaceDeleteEntryResponseSchema,
  workspaceEntryPathResponseSchema,
  workspaceEntryRequestSchema,
  workspaceFailureSchema,
  workspaceFilesSchema,
  workspaceMoveEntryRequestSchema,
  workspaceRenameEntryRequestSchema,
  workspaceRevealRequestSchema,
  workspaceRevealResponseSchema,
  type WorkspaceFilesWire,
} from '@/protocols/http/files';
import { encodePathSegments } from '@/shared/utils/file-path';

import { createFileOperation } from './file-operation';

function mapListing(listing: WorkspaceFilesWire): WorkspaceListing {
  return {
    files: listing.files.map((file) => ({
      availability: file.availability ?? 'available',
      format: file.format,
      kind: file.entryKind ?? 'regular',
      path: file.name,
      size: file.size,
    })),
    folderName: listing.folder,
    folders: listing.folders.map((folder) => ({
      kind: folder.kind ?? 'normal',
      path: folder.path,
    })),
    showHiddenFiles: listing.showHiddenFiles,
  };
}

/** The files routes answer with a wider ladder than the shared one: a folder
 *  that moved under an open window (409 FOLDER_CHANGED), a name already taken,
 *  and a name the server refuses outright. */
function operationFailure({ response, serverMessage }: TransportFailure): FilesError {
  const failure = workspaceFailureSchema.safeParse(response.body);
  const folderChanged =
    response.status === 409 && failure.success && failure.data.code === 'FOLDER_CHANGED';
  const scopeLost =
    response.status === 412 ||
    folderChanged ||
    (response.status === 410 && failure.success && failure.data.code === 'FOLDER_UNAVAILABLE');
  const unauthorized =
    response.status === 401 || response.status === 403 || response.status === 410;
  const conflict = response.status === 409 && !folderChanged;
  const rejected = response.status === 400 || response.status === 404 || response.status === 415;
  return new FilesError(
    scopeLost
      ? 'scope-lost'
      : unauthorized
        ? 'unauthorized'
        : conflict
          ? 'conflict'
          : rejected
            ? 'rejected'
            : 'unavailable',
    scopeLost
      ? 'This project is no longer available in this window.'
      : unauthorized
        ? 'This window can no longer access that project.'
        : conflict
          ? 'Something with that name already exists.'
          : rejected
            ? 'That name cannot be used.'
            : 'The files are unavailable.',
    serverMessage === null ? undefined : { cause: new Error(serverMessage) },
  );
}

function folderQuery(folderPath: string): string {
  return new URLSearchParams({ folder: folderPath }).toString();
}

/** One files call: the shared envelope plus the files failure ladder. */
function files(
  path: string,
  signal: AbortSignal,
  extra?: { body?: unknown; method?: TransportRequest['method'] },
): TransportRequest<'conflict' | 'rejected' | 'outcome-unknown'> {
  return {
    ...(extra?.body === undefined ? {} : { body: extra.body }),
    error: FilesError,
    failure: operationFailure,
    failureSchema: workspaceFailureSchema,
    ...(extra?.method === undefined ? {} : { method: extra.method }),
    path,
    signal,
  };
}

/** The server settles a created or renamed entry's own path, and answers with
 *  it under either key. */
const entryPathSchema: ResponseSchema<{ path: string }> = {
  safeParse(input) {
    const parsed = workspaceEntryPathResponseSchema.safeParse(input);
    const path = parsed.success ? (parsed.data.name ?? parsed.data.path) : undefined;
    return path === undefined ? { success: false } : { success: true, data: { path } };
  },
};

export function createFilesAdapter(client: HttpClient): FilesPort {
  const mutate = createFileOperation(client);
  return {
    async load(folderPath, signal) {
      return mapListing(
        await request(client, {
          ...files(`/api/files?${folderQuery(folderPath)}`, signal),
          schema: workspaceFilesSchema,
        }),
      );
    },
    async reveal(folderPath, targetPath, signal) {
      const reveal = workspaceRevealRequestSchema.safeParse({ folderPath, path: targetPath });
      if (!reveal.success) throw new FilesError('unavailable', 'The item identity is invalid.');
      await request(client, {
        ...files(
          `/api/reveal/${encodePathSegments(reveal.data.path)}?${folderQuery(reveal.data.folderPath)}`,
          signal,
          { method: 'POST' },
        ),
        schema: workspaceRevealResponseSchema,
      });
    },
    async createEntry(folderPath, kind, parentPath, name, signal) {
      const create = workspaceCreateEntryRequestSchema.safeParse({
        folderPath,
        kind,
        name,
        parentPath,
      });
      if (!create.success) throw new FilesError('rejected', 'That name cannot be used.');
      const { data } = create;
      return mutate({
        ...files(
          data.kind === 'file'
            ? `/api/files?${folderQuery(data.folderPath)}`
            : `/api/folders?${folderQuery(data.folderPath)}`,
          signal,
          {
            body:
              data.kind === 'file'
                ? { dir: data.parentPath, name: data.name }
                : { path: joinTreePath(data.parentPath, data.name) },
            method: 'POST',
          },
        ),
        schema: entryPathSchema,
      });
    },
    async renameEntry(folderPath, entry, name, signal) {
      const rename = workspaceRenameEntryRequestSchema.safeParse({
        folderPath,
        kind: entry.kind,
        name,
        path: entry.path,
      });
      if (!rename.success) throw new FilesError('rejected', 'That name cannot be used.');
      const { data } = rename;
      return mutate({
        ...files(
          `/api/${data.kind === 'file' ? 'files' : 'folders'}/${encodePathSegments(data.path)}?${folderQuery(data.folderPath)}`,
          signal,
          { body: { new_name: data.name }, method: 'PATCH' },
        ),
        schema: entryPathSchema,
      });
    },
    async moveEntry(folderPath, entry, parentPath, signal) {
      const move = workspaceMoveEntryRequestSchema.safeParse({
        folderPath,
        kind: entry.kind,
        parentPath,
        path: entry.path,
      });
      if (!move.success) throw new FilesError('rejected', 'That item cannot be moved.');
      const { data } = move;
      return mutate({
        ...files(
          `/api/${data.kind === 'file' ? 'files' : 'folders'}/${encodePathSegments(data.path)}?${folderQuery(data.folderPath)}`,
          signal,
          { body: { dir: data.parentPath }, method: 'PATCH' },
        ),
        schema: entryPathSchema,
      });
    },
    async deleteEntry(folderPath, entry, signal) {
      const remove = workspaceEntryRequestSchema.safeParse({
        folderPath,
        kind: entry.kind,
        path: entry.path,
      });
      if (!remove.success) throw new FilesError('rejected', 'The item identity is invalid.');
      const { data } = remove;
      await mutate({
        ...files(
          `/api/${data.kind === 'file' ? 'files' : 'folders'}/${encodePathSegments(data.path)}?${folderQuery(data.folderPath)}`,
          signal,
          { method: 'DELETE' },
        ),
        schema: workspaceDeleteEntryResponseSchema,
      });
    },
  };
}
