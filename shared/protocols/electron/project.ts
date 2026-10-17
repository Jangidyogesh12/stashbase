import { z } from 'zod';

export const PROJECT_FOLDER_DIALOG_CAPABILITY = 'project.choose-folder';
export const PROJECT_FOLDER_DIALOG_CHANNEL = 'project:choose-folder';
export const PROJECT_LIFECYCLE_CAPABILITY = 'project.lifecycle';
export const PROJECT_SET_ACTIVE_FOLDER_CHANNEL = 'project:set-active-folder';
export const PROJECT_ENTRY_CANCEL_CHANNEL = 'project:entry-cancel';
export const PROJECT_ENTRY_CANCELLED_CHANNEL = 'project:entry-cancelled';
export const PROJECT_ENTRY_REQUESTED_CHANNEL = 'project:entry-requested';
export const PROJECT_ENTRY_PENDING_CHANNEL = 'project:entry-pending';
export const PROJECT_ENTRY_FINISHED_CHANNEL = 'project:entry-finished';
export const PROJECT_OPEN_FOLDER_WINDOW_CHANNEL = 'project:open-folder-window';
export const PROJECT_PREPARE_FOLDER_REMOVAL_CHANNEL = 'project:prepare-folder-removal';
export const PROJECT_FOLDER_REMOVAL_REQUESTED_CHANNEL = 'project:folder-removal-requested';
export const PROJECT_FOLDER_REMOVAL_READY_CHANNEL = 'project:folder-removal-ready';
export const PROJECT_NOTIFY_FOLDER_REMOVED_CHANNEL = 'project:notify-folder-removed';
export const PROJECT_FOLDER_REMOVED_CHANNEL = 'project:folder-removed';

const folderPathSchema = z.string().min(1).max(4096)
  .refine((value) => value.trim().length > 0, 'Path must contain a visible character.');

export const projectFolderDialogRequestSchema = z
  .object({
    allowCreateDirectory: z.boolean().default(true),
    defaultPath: folderPathSchema.optional(),
  })
  .strict();

const projectFolderDialogSuccessSchema = z.object({
  folderPath: folderPathSchema.nullable(),
  ok: z.literal(true),
});

export const projectFolderDialogFailureSchema = z.object({
  failure: z
    .object({
      kind: z.enum(['unauthorized', 'unavailable', 'invalid-response', 'fatal']),
      message: z.string().trim().min(1).max(240),
    })
    .strict(),
  ok: z.literal(false),
});

export const projectFolderDialogResponseSchema = z.union([
  projectFolderDialogSuccessSchema,
  projectFolderDialogFailureSchema,
]);

export const projectFolderPathRequestSchema = z.object({ folderPath: folderPathSchema }).strict();

export const projectSetActiveFolderRequestSchema = z
  .object({ folderPath: folderPathSchema.nullable() })
  .strict();

export const projectFolderRemovalRequestedSchema = z
  .object({
    folderPath: folderPathSchema,
    requestId: z.string().trim().min(1).max(128),
  })
  .strict();

export const projectFolderRemovalReadySchema = projectFolderRemovalRequestedSchema
  .extend({ ready: z.boolean() })
  .strict();

const projectLifecycleSuccessSchema = z.object({ ok: z.literal(true) }).strict();

const projectPrepareFolderRemovalSuccessSchema = z
  .object({ ok: z.literal(true), ready: z.boolean() })
  .strict();

/** Opening a member in a window answers which of the two things happened, so
 *  a caller can say "opened it" without claiming a second window that main
 *  deliberately did not make: a folder already on screen is focused instead. */
const projectOpenFolderWindowSuccessSchema = z
  .object({ ok: z.literal(true), action: z.enum(['opened', 'focused']) })
  .strict();

export const projectLifecycleResponseSchema = z.union([
  projectLifecycleSuccessSchema,
  projectFolderDialogFailureSchema,
]);

export const projectPrepareFolderRemovalResponseSchema = z.union([
  projectPrepareFolderRemovalSuccessSchema,
  projectFolderDialogFailureSchema,
]);

export const projectOpenFolderWindowResponseSchema = z.union([
  projectOpenFolderWindowSuccessSchema,
  projectFolderDialogFailureSchema,
]);

export type ProjectFolderDialogRequest = z.infer<typeof projectFolderDialogRequestSchema>;
export type ProjectFolderDialogFailure = z.infer<typeof projectFolderDialogFailureSchema>;
export type ProjectFolderDialogResponse = z.infer<typeof projectFolderDialogResponseSchema>;
export type ProjectLifecycleResponse = z.infer<typeof projectLifecycleResponseSchema>;
export type ProjectPrepareFolderRemovalResponse = z.infer<
  typeof projectPrepareFolderRemovalResponseSchema
>;
export type ProjectOpenFolderWindowResponse = z.infer<
  typeof projectOpenFolderWindowResponseSchema
>;

export const projectEntryRequestSchema = z.object({
  requestId: z.string().uuid(),
  folderPath: folderPathSchema,
}).strict();
export const projectEntryPendingSchema = projectEntryRequestSchema.nullable();
export const projectEntryFinishedSchema = projectEntryRequestSchema.extend({
  failure: z.string().min(1).max(500).nullable(),
}).strict();
export type ProjectEntryRequest = z.infer<typeof projectEntryRequestSchema>;

export const projectEntryCancelSchema = z.object({ requestId: z.string().uuid() }).strict();
export const projectEntryStartSchema = projectFolderPathRequestSchema.extend({ requestId: z.string().uuid().optional() }).strict();
