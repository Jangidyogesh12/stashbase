import { z } from 'zod';

/** One model a runtime offers, as both the socket's catalog event and the
 * runtime listing's remembered catalog carry it. Lives outside both so the
 * two protocol modules share one shape without importing each other. */
export const agentModelSchema = z
  .object({
    id: z.string().max(200),
    label: z.string().max(500),
    description: z.string().max(2_000).optional(),
    /** The release an alias resolves to ("Opus 5.5" for Claude's "Opus"),
     *  where the runtime names models by alias and says the release only in
     *  its own description. */
    release: z.string().max(200).optional(),
    supportedEfforts: z.array(z.string().max(64)).max(32).optional(),
    /** The effort the runtime runs this model at when none is chosen. */
    defaultEffort: z.string().max(64).optional(),
    /** Whether the runtime runs this model when none is chosen. */
    isDefault: z.boolean().optional(),
    /** Price relative to the runtime's default model (1), for a runtime that
     *  bills through StashBase; the picker flags the expensive ones. */
    relativeCost: z.number().positive().max(10_000).optional(),
  })
  .strict();

export type AgentModel = z.infer<typeof agentModelSchema>;
