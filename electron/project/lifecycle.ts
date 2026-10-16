import crypto from 'node:crypto';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';

import {
  PROJECT_ENTRY_REQUESTED_CHANNEL,
  PROJECT_ENTRY_CANCEL_CHANNEL,
  PROJECT_ENTRY_CANCELLED_CHANNEL,
  projectEntryStartSchema,
  projectEntryCancelSchema,
  PROJECT_ENTRY_PENDING_CHANNEL,
  PROJECT_ENTRY_FINISHED_CHANNEL,
  projectEntryFinishedSchema,
  type ProjectEntryRequest,
  PROJECT_FOLDER_REMOVAL_READY_CHANNEL,
  PROJECT_FOLDER_REMOVAL_REQUESTED_CHANNEL,
  PROJECT_FOLDER_REMOVED_CHANNEL,
  PROJECT_LIFECYCLE_CAPABILITY,
  PROJECT_NOTIFY_FOLDER_REMOVED_CHANNEL,
  PROJECT_OPEN_FOLDER_WINDOW_CHANNEL,
  PROJECT_PREPARE_FOLDER_REMOVAL_CHANNEL,
  PROJECT_SET_ACTIVE_FOLDER_CHANNEL,
  type ProjectFolderDialogFailure,
  projectFolderPathRequestSchema,
  projectFolderRemovalReadySchema,
  projectLifecycleResponseSchema,
  projectOpenFolderWindowResponseSchema,
  projectPrepareFolderRemovalResponseSchema,
  projectSetActiveFolderRequestSchema,
} from '../../shared/protocols/electron/project.ts';
import { createAckCoordinator } from '../ack-coordinator.ts';
import { authorizeSender, type SenderAuthorization } from './dialog.ts';

export { PROJECT_LIFECYCLE_CAPABILITY };

interface WindowWebContents {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

type LifecycleWindow = BrowserWindow & { webContents: WindowWebContents };

export interface LifecycleDependencies extends SenderAuthorization {
  ipcMain: Pick<IpcMain, 'handle'>;
  liveWindows(): LifecycleWindow[];
  /** Main applies the shared window rule and waits for renderer readiness. */
  openFolderWindow(
    window: BrowserWindow,
    folderPath: string,
    enterFolder: (window: BrowserWindow, path: string) => Promise<void>,
    signal: AbortSignal,
  ): Promise<'opened' | 'focused' | null>;
  setActiveFolder(window: BrowserWindow, folderPath: string | null): boolean;
  windowsForFolder(folderPath: string): LifecycleWindow[] | Promise<LifecycleWindow[]>;
}

const failure = (
  kind: ProjectFolderDialogFailure['failure']['kind'],
  message: string,
): ProjectFolderDialogFailure => ({ ok: false, failure: { kind, message } });

export function createFolderRemovalCoordinator({
  createRequestId,
  timeoutMs,
}: {
  createRequestId?: () => string;
  timeoutMs?: number;
} = {}) {
  const acks = createAckCoordinator({
    channel: PROJECT_FOLDER_REMOVAL_REQUESTED_CHANNEL,
    message: (folderPath, requestId) => ({ folderPath, requestId }),
    createRequestId,
    timeoutMs,
  });

  return {
    request(window: LifecycleWindow, folderPath: string): Promise<boolean> {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve(true);
      return acks.request(window.webContents, folderPath);
    },
    settle(webContentsId: number, payload: unknown): boolean {
      const response = projectFolderRemovalReadySchema.safeParse(payload);
      return response.success && acks.acknowledge(
        webContentsId,
        response.data.requestId,
        response.data.folderPath,
        response.data.ready,
      );
    },
  };
}

export interface ProjectLifecycle {
  /** Enters `folderPath` in a window main opened itself, through the same
   *  acknowledged handoff as every other entry. */
  enterFolder(window: BrowserWindow, folderPath: string, signal?: AbortSignal): Promise<void>;
}

export function registerLifecycle(dependencies: LifecycleDependencies): ProjectLifecycle {
  const coordinator = createFolderRemovalCoordinator();
  const entries = createProjectEntryCoordinator();
  const requests = new Map<string, AbortController>();
  dependencies.ipcMain.handle(PROJECT_ENTRY_CANCEL_CHANNEL, (event, payload) => {
    if (!authorizeSender(event, dependencies, PROJECT_LIFECYCLE_CAPABILITY)) return failure('unauthorized', 'This window cannot cancel project entry.');
    const parsed = projectEntryCancelSchema.safeParse(payload);
    if (!parsed.success) return failure('invalid-response', 'Invalid project entry cancellation.');
    requests.get(`${event.sender.id}:${parsed.data.requestId}`)?.abort();
    return { ok: true };
  });
  dependencies.ipcMain.handle(PROJECT_ENTRY_PENDING_CHANNEL, (event) => {
    if (!authorizeSender(event, dependencies, PROJECT_LIFECYCLE_CAPABILITY)) return null;
    return entries.pending(event.sender.id);
  });
  dependencies.ipcMain.handle(PROJECT_ENTRY_FINISHED_CHANNEL, (event, payload) => {
    if (!authorizeSender(event, dependencies, PROJECT_LIFECYCLE_CAPABILITY)) {
      return failure('unauthorized', 'This window cannot acknowledge project entry.');
    }
    return entries.finish(event.sender.id, payload)
      ? { ok: true }
      : failure('invalid-response', 'That project entry is no longer pending.');
  });

  dependencies.ipcMain.handle(PROJECT_SET_ACTIVE_FOLDER_CHANNEL, (event, rawRequest) => {
    const senderWindow = authorizeSender(event, dependencies, PROJECT_LIFECYCLE_CAPABILITY);
    if (!senderWindow) {
      return failure('unauthorized', 'This window cannot update its folder lifecycle.');
    }
    const request = projectSetActiveFolderRequestSchema.safeParse(rawRequest);
    if (!request.success) {
      return failure('invalid-response', 'The active folder request was invalid.');
    }
    if (!dependencies.setActiveFolder(senderWindow, request.data.folderPath)) {
      return failure('unavailable', 'The window folder lifecycle is unavailable.');
    }
    return projectLifecycleResponseSchema.parse({ ok: true });
  });

  dependencies.ipcMain.handle(PROJECT_OPEN_FOLDER_WINDOW_CHANNEL, async (event, rawRequest) => {
    const senderWindow = authorizeSender(event, dependencies, PROJECT_LIFECYCLE_CAPABILITY);
    if (!senderWindow) {
      return failure('unauthorized', 'This window cannot open another window.');
    }
    const request = projectEntryStartSchema.safeParse(rawRequest);
    if (!request.success) {
      return failure('invalid-response', 'The folder window request was invalid.');
    }
    // The path is a folder path the schema accepted, not a membership claim.
    // Main decides whether it can be shown, exactly as it does for every other
    // way a folder reaches a window.
    const controller = new AbortController();
    const key = `${event.sender.id}:${request.data.requestId}`;
    requests.set(key, controller);
    const closed = () => controller.abort();
    senderWindow.once?.('closed', closed);
    try {
      const action = await dependencies.openFolderWindow(senderWindow, request.data.folderPath,
        (window, path) => entries.request(window, path, controller.signal), controller.signal);
      if (!action) return failure('unavailable', 'That project could not be opened.');
      return projectOpenFolderWindowResponseSchema.parse({ action, ok: true });
    } catch (error) {
      return failure('unavailable', error instanceof Error
        ? error.message.slice(0, 240) : 'That project could not be opened.');
    } finally {
      requests.delete(key);
      senderWindow.removeListener?.('closed', closed);
    }
  });

  dependencies.ipcMain.handle(PROJECT_PREPARE_FOLDER_REMOVAL_CHANNEL, async (event, rawRequest) => {
    const senderWindow = authorizeSender(event, dependencies, PROJECT_LIFECYCLE_CAPABILITY);
    if (!senderWindow) {
      return failure('unauthorized', 'This window cannot prepare folder removal.');
    }
    const request = projectFolderPathRequestSchema.safeParse(rawRequest);
    if (!request.success) {
      return failure('invalid-response', 'The folder removal request was invalid.');
    }
    const readiness = await Promise.all(
      (await dependencies.windowsForFolder(request.data.folderPath))
        .map((window) => coordinator.request(window, request.data.folderPath)),
    );
    return projectPrepareFolderRemovalResponseSchema.parse({
      ok: true,
      ready: readiness.every(Boolean),
    });
  });

  dependencies.ipcMain.handle(
    PROJECT_FOLDER_REMOVAL_READY_CHANNEL,
    (event: IpcMainInvokeEvent, rawResponse) => {
      const senderWindow = authorizeSender(event, dependencies, PROJECT_LIFECYCLE_CAPABILITY);
      if (!senderWindow) {
        return failure('unauthorized', 'This window cannot acknowledge folder removal.');
      }
      if (!coordinator.settle(event.sender.id, rawResponse)) {
        return failure('invalid-response', 'The folder removal acknowledgement was stale.');
      }
      return projectLifecycleResponseSchema.parse({ ok: true });
    },
  );

  dependencies.ipcMain.handle(PROJECT_NOTIFY_FOLDER_REMOVED_CHANNEL, (event, rawRequest) => {
    const senderWindow = authorizeSender(event, dependencies, PROJECT_LIFECYCLE_CAPABILITY);
    if (!senderWindow) {
      return failure('unauthorized', 'This window cannot reconcile folder removal.');
    }
    const request = projectFolderPathRequestSchema.safeParse(rawRequest);
    if (!request.success) {
      return failure('invalid-response', 'The removed folder request was invalid.');
    }
    for (const window of dependencies.liveWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(PROJECT_FOLDER_REMOVED_CHANNEL, request.data);
      }
    }
    return projectLifecycleResponseSchema.parse({ ok: true });
  });

  return {
    enterFolder: (window, folderPath, signal) => entries.request(window, folderPath, signal),
  };
}

/** A request remains claimable until acknowledged: a newly created renderer
 * can subscribe after the initial event. Only its authorized window can finish. */
export function createProjectEntryCoordinator(timeoutMs = 30_000) {
  const pending = new Map<number, {
    request: ProjectEntryRequest;
    settle(error: string | null): void;
  }>();
  return {
    pending: (id: number) => pending.get(id)?.request ?? null,
    request(window: BrowserWindow, folderPath: string, signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) return Promise.reject(new Error('Opening was cancelled.'));
      if (window.isDestroyed()) return Promise.reject(new Error('The project window closed.'));
      const id = window.webContents.id;
      if (pending.has(id)) return Promise.reject(new Error('A project is already opening.'));
      return new Promise((resolve, reject) => {
        const closed = () => settle('The project window closed before it was ready.');
        const aborted = () => settle('Opening was cancelled.');
        const timer = setTimeout(() => settle('The project did not become ready. Try opening it again.'), timeoutMs);
        const settle = (error: string | null) => {
          pending.delete(id);
          clearTimeout(timer);
          window.removeListener('closed', closed);
          signal?.removeEventListener('abort', aborted);
          if (error && !window.isDestroyed()) {
            try { window.webContents.send(PROJECT_ENTRY_CANCELLED_CHANNEL, { requestId: request.requestId }); }
            catch { /* A destroyed renderer cannot acknowledge cancellation. */ }
          }
          if (error) reject(new Error(error)); else resolve();
        };
        const request = { folderPath, requestId: crypto.randomUUID() };
        pending.set(id, { request, settle });
        window.once('closed', closed);
        signal?.addEventListener('abort', aborted, { once: true });
        try { window.webContents.send(PROJECT_ENTRY_REQUESTED_CHANNEL, request); }
        catch { settle('The project window could not receive the entry request.'); }
      });
    },
    finish(id: number, payload: unknown) {
      const parsed = projectEntryFinishedSchema.safeParse(payload);
      const entry = pending.get(id);
      if (!parsed.success || !entry || entry.request.requestId !== parsed.data.requestId
        || entry.request.folderPath !== parsed.data.folderPath) return false;
      entry.settle(parsed.data.failure);
      return true;
    },
  };
}
