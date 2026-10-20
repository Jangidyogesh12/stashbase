import { z } from 'zod';

import { agentIdSchema } from '../http/agent-runtime';

/** A project window may start the chats its project's scheduled tasks ask
 *  for, and ask main to run one of them now. */
export const SCHEDULED_TASKS_CAPABILITY = 'scheduled-tasks.run';

/** Main asks a project window to start one run's chat. */
export const SCHEDULED_RUN_REQUESTED_CHANNEL = 'scheduled-tasks:run-requested';
/** A window that subscribed late takes the runs already waiting for it. */
export const SCHEDULED_RUN_PENDING_CHANNEL = 'scheduled-tasks:run-pending';
/** The window says whether that chat started. */
export const SCHEDULED_RUN_FINISHED_CHANNEL = 'scheduled-tasks:run-finished';
/** The task list's Run now. */
export const SCHEDULED_RUN_NOW_CHANNEL = 'scheduled-tasks:run-now';

const folderPathSchema = z.string().min(1).max(4096)
  .refine((value) => value.trim().length > 0, 'Path must contain a visible character.');
const requestIdSchema = z.string().trim().min(1).max(128);
const reasonSchema = z.string().trim().min(1).max(500);

/** One run as the window starts it: a new chat with this title, this request
 *  and these project files, on this Agent (null: the project's choice). */
export const scheduledRunRequestSchema = z
  .object({
    agent: agentIdSchema.nullable(),
    files: z.array(z.string().min(1).max(4096)).max(20),
    folderPath: folderPathSchema,
    prompt: z.string().max(32_000),
    requestId: requestIdSchema,
    /** The run the window reports its first turn's outcome against. */
    runId: z.string().min(1).max(64),
    taskId: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export const scheduledRunPendingSchema = z.array(scheduledRunRequestSchema).max(50);

/** `sent`: the chat exists and its request was accepted. `failed`: the reason
 *  the reader reads beside the task. */
export const scheduledRunOutcomeSchema = z.discriminatedUnion('status', [
  z
    .object({
      agent: agentIdSchema,
      sessionId: z.string().min(1).max(256),
      status: z.literal('sent'),
    })
    .strict(),
  z.object({ reason: reasonSchema, status: z.literal('failed') }).strict(),
]);

export const scheduledRunFinishedSchema = z
  .object({ outcome: scheduledRunOutcomeSchema, requestId: requestIdSchema })
  .strict();

export const scheduledRunNowRequestSchema = z
  .object({ folderPath: folderPathSchema, taskId: z.string().min(1).max(64) })
  .strict();

export const scheduledRunNowResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), outcome: scheduledRunOutcomeSchema }).strict(),
  z
    .object({
      failure: z
        .object({
          kind: z.enum(['unauthorized', 'invalid-request', 'unavailable']),
          message: reasonSchema,
        })
        .strict(),
      ok: z.literal(false),
    })
    .strict(),
]);

export type ScheduledRunRequest = z.infer<typeof scheduledRunRequestSchema>;
export type ScheduledRunOutcome = z.infer<typeof scheduledRunOutcomeSchema>;
export type ScheduledRunNowResponse = z.infer<typeof scheduledRunNowResponseSchema>;
