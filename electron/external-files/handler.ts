import path from 'node:path';
import type { BrowserWindow, IpcMain } from 'electron';

import {
  EXTERNAL_FILES_CAPABILITY,
  EXTERNAL_FILES_OPEN_CHANNEL,
  externalFilesOpenResponseSchema,
  externalFilesPathRequestSchema,
} from '../../shared/protocols/electron/external-files.ts';
import { externalFileOpenResultSchema } from '../../shared/protocols/http/external-files.ts';
import { authorizeSender, type SenderAuthorization } from '../project/dialog.ts';

export { EXTERNAL_FILES_CAPABILITY };

export interface ExternalFilesDependencies extends SenderAuthorization {
  ipcMain: Pick<IpcMain, 'handle'>;
  /** The request identity main stamps on this window's server traffic. */
  windowIdFor(window: BrowserWindow): string | null;
  /** Registers one dropped path with the app server for that window. */
  register(windowId: string, filePath: string): Promise<unknown>;
}

type Failure = { ok: false; failure: { kind: 'invalid-request' | 'unauthorized' | 'unavailable'; message: string } };

const failure = (kind: Failure['failure']['kind'], message: string): Failure => ({
  failure: { kind, message },
  ok: false,
});

export function registerExternalFiles(dependencies: ExternalFilesDependencies): void {
  dependencies.ipcMain.handle(EXTERNAL_FILES_OPEN_CHANNEL, async (event, rawRequest) => {
    const sender = authorizeSender(event, dependencies, EXTERNAL_FILES_CAPABILITY);
    const windowId = sender ? dependencies.windowIdFor(sender) : null;
    if (!sender || !windowId) return failure('unauthorized', 'This window cannot open files.');
    const request = externalFilesPathRequestSchema.safeParse(rawRequest);
    if (!request.success || !path.isAbsolute(request.data.path)) {
      return failure('invalid-request', 'This file has no location on disk.');
    }
    try {
      const result = externalFileOpenResultSchema.safeParse(
        await dependencies.register(windowId, request.data.path),
      );
      return result.success
        ? externalFilesOpenResponseSchema.parse({ ok: true, result: result.data })
        : failure('unavailable', 'The file could not be opened.');
    } catch {
      return failure('unavailable', 'The file could not be opened.');
    }
  });
}
