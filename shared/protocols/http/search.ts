import { z } from 'zod';

const folderPathSchema = z.string().trim().min(1).max(4096);
const relativePathSchema = z.string().trim().min(1).max(4096);

export const exactSearchRequestSchema = z
  .object({
    case_strict: z.boolean(),
    folder: folderPathSchema,
    query: z.string().trim().min(1).max(4096),
    whole_word: z.boolean(),
  })
  .strict();

const exactSearchRangeSchema = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([start, end]) => end >= start, 'match range end must not precede its start');

const exactSearchMatchSchema = z
  .object({
    line: z.number().int().positive(),
    pdfPage: z.number().int().positive().optional(),
    ranges: z.array(exactSearchRangeSchema).max(256),
    text: z.string().max(16_384),
  })
  .strict();

export const exactSearchResponseSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            folder: folderPathSchema,
            matches: z.array(exactSearchMatchSchema).max(1024),
            path: relativePathSchema,
            totalMatches: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(10_000),
    totalMatches: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();

export const exactSearchFailureSchema = z
  .object({
    code: z.string().trim().min(1).max(64).optional(),
    error: z.string().trim().min(1).max(500),
  })
  .passthrough();

export type ExactSearchResponseWire = z.infer<typeof exactSearchResponseSchema>;
