import {
  EXTERNAL_FILES_OPEN_CHANNEL,
  type ExternalFilesOpenResponse,
  externalFilesOpenResponseSchema,
  externalFilesPathRequestSchema,
} from '../../shared/protocols/electron/external-files.ts';

export interface IpcRenderer {
  invoke(channel: string, payload: unknown): Promise<unknown>;
}

/**
 * Files the reader dropped on the document pane. `open` takes the dropped
 * `File` itself, never a path: preload reads the location off the file, and a
 * `File` built in script has none, so only a real drop can name a file here.
 */
export interface ExternalFilesPreload {
  open(file: File): Promise<ExternalFilesOpenResponse>;
}

const failure = (
  kind: 'invalid-request' | 'unavailable',
  message: string,
): { ok: false; failure: { kind: 'invalid-request' | 'unavailable'; message: string } } => ({
  failure: { kind, message },
  ok: false,
});

export function createExternalFilesPreload(
  ipcRenderer: IpcRenderer,
  pathForFile: (file: File) => string,
): ExternalFilesPreload {
  const request = (file: File) => {
    let path = '';
    try {
      path = pathForFile(file);
    } catch {
      path = '';
    }
    const parsed = externalFilesPathRequestSchema.safeParse({ path });
    return parsed.success ? parsed.data : null;
  };
  return Object.freeze({
    async open(file: File) {
      const payload = request(file);
      if (!payload) return failure('invalid-request', 'This file has no location on disk.');
      try {
        const response = externalFilesOpenResponseSchema.safeParse(
          await ipcRenderer.invoke(EXTERNAL_FILES_OPEN_CHANNEL, payload),
        );
        return response.success ? response.data : failure('unavailable', 'The file could not be opened.');
      } catch {
        return failure('unavailable', 'The file could not be opened.');
      }
    },
  });
}
