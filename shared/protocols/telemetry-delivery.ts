import { z } from 'zod';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const series = { series_id: z.string().uuid(), started_at: z.string().datetime() };
/** Cumulative checkpoints, never additive event counts. A series belongs to one
 * collection period on an installation/renderer, not to a person's activity. */
export const hostDeliverySchema = z.object({
  ...series,
  counters: z.object({
    attempted: count.optional(), accepted: count.optional(), duplicate: count.optional(),
    invalid: count.optional(), queue_full: count.optional(), rate_limited: count.optional(),
    turn_limit: count.optional(), missing_start: count.optional(), stale: count.optional(),
    storage_failed: count.optional(), delivered: count.optional(), transport_failed: count.optional(),
    rejected: count.optional(), expired: count.optional(), invalid_queued: count.optional(),
  }).strict(),
}).strict();
export const rendererDeliverySchema = z.object({
  ...series,
  counters: z.object({
    generated: count.optional(), coalesced: count.optional(), invalid: count.optional(),
    overflow: count.optional(), requests: count.optional(), accepted: count.optional(),
    duplicate: count.optional(), refused: count.optional(), exhausted: count.optional(),
  }).strict(),
}).strict();
export type HostDelivery = z.infer<typeof hostDeliverySchema>;
export type RendererDelivery = z.infer<typeof rendererDeliverySchema>;

export function countDelivery<T extends HostDelivery | RendererDelivery>(
  snapshot: T, key: keyof T['counters'], amount = 1,
): void {
  const counters = snapshot.counters as Partial<Record<keyof T['counters'], number>>;
  counters[key] = Math.min(Number.MAX_SAFE_INTEGER, (counters[key] ?? 0) + amount);
}
