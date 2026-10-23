import { z } from 'zod';

import { externalFileOpenRequestSchema, externalFileOpenResultSchema } from '../http/external-files';

export const EXTERNAL_FILES_CAPABILITY = 'external-files.open';
export const EXTERNAL_FILES_OPEN_CHANNEL = 'external-files:open';

/** Preload sends only the path it read from a dropped `File` itself. */
export const externalFilesPathRequestSchema = externalFileOpenRequestSchema;

const failureSchema = z
  .object({
    failure: z
      .object({
        kind: z.enum(['invalid-request', 'unauthorized', 'unavailable']),
        message: z.string().trim().min(1).max(240),
      })
      .strict(),
    ok: z.literal(false),
  })
  .strict();

export const externalFilesOpenResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: externalFileOpenResultSchema }).strict(),
  failureSchema,
]);

export type ExternalFilesOpenResponse = z.infer<typeof externalFilesOpenResponseSchema>;
