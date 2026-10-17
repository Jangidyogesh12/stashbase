import { z } from 'zod';

/** `GET /api/workspace-preferences` and the `PUT` echo. The server resolves an
 *  absent or invalid stored value to `false`, so the response always carries
 *  the state it actually applied rather than what was asked for. */
export const workspacePreferencesSchema = z
  .object({ showHiddenFiles: z.boolean() })
  .strip();

/** The write is strict. It reaches durable configuration, so an unknown key is
 *  a caller mistake to refuse rather than a value to persist forever. */
export const workspacePreferencesRequestSchema = z
  .object({ showHiddenFiles: z.boolean() })
  .strict();
