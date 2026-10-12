import { z } from 'zod';

export const EXTERNAL_NAVIGATION_CAPABILITY = 'external-navigation.open';
export const EXTERNAL_NAVIGATION_OPEN_CHANNEL = 'external-navigation:open';

const externalUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.username.length === 0 &&
        url.password.length === 0
      );
    } catch {
      return false;
    }
  }, 'Expected a credential-free HTTP(S) URL.');

export const externalNavigationRequestSchema = z.object({ url: externalUrlSchema }).strict();

export const externalNavigationResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z
    .object({
      failure: z
        .object({
          kind: z.enum(['invalid-request', 'unauthorized', 'unavailable']),
          message: z.string().trim().min(1).max(240),
        })
        .strict(),
      ok: z.literal(false),
    })
    .strict(),
]);

export type ExternalNavigationResponse = z.infer<typeof externalNavigationResponseSchema>;
