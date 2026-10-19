import { z } from 'zod';
import { VIEWER_FORMATS } from '../../file-formats';

const relativePathSchema = z.string().min(1).max(4096);
const folderPathSchema = z.string().trim().min(1).max(4096);
const sourceVersionSchema = z.string().trim().min(1).max(256);
const boundedSourceTextSchema = z.string().max(8 * 1024 * 1024);

const viewerFormatSchema = z.enum(VIEWER_FORMATS);

export const WORKSPACE_FILE_KINDS = ['regular', 'symlink', 'special', 'cloud-placeholder'] as const;
export const WORKSPACE_ENTRY_AVAILABILITIES = ['available', 'unreadable'] as const;

const workspaceFileSchema = z
  .object({
    availability: z.enum(WORKSPACE_ENTRY_AVAILABILITIES).optional(),
    entryKind: z.enum(WORKSPACE_FILE_KINDS).optional(),
    format: viewerFormatSchema,
    heading: z.string().max(16_384),
    imported_at: z.string().max(64),
    name: relativePathSchema,
    size: z.number().finite().nonnegative(),
    snippet: z.string().max(16_384),
  })
  .strict();

const workspaceFolderSchema = z
  .object({
    kind: z.enum(['normal', 'excluded', 'unreadable']).optional(),
    path: relativePathSchema,
  })
  .strict();

export const workspaceFilesSchema = z
  .object({
    files: z.array(workspaceFileSchema),
    folder: z.string().trim().min(1).max(255),
    folders: z.array(workspaceFolderSchema),
    /** The visibility the server actually applied. Echoed so every window's
     * menu tracks server truth, including folder-explicit workspace listings. */
    showHiddenFiles: z.boolean(),
  })
  .strict();

export const workspaceFailureSchema = z
  .object({
    code: z.string().trim().min(1).max(64).optional(),
    error: z.string().trim().min(1).max(500),
  })
  .passthrough();

export const workspaceRevealResponseSchema = z.object({}).strict();

export const workspaceRevealRequestSchema = z
  .object({
    folderPath: folderPathSchema,
    path: relativePathSchema,
  })
  .strict();

/** One leaf name: no separators, no traversal, and something left once
 *  trimmed. Whether the server keeps or completes an extension is the
 *  server's rule; the wire only rules out names that could leave the parent. */
const workspaceEntryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((name) => !/[\\/]/u.test(name) && name !== '.' && name !== '..', {
    message: 'entry names cannot contain separators',
  });

const workspaceEntryKindSchema = z.enum(['file', 'folder']);

/** Identity of one file or folder inside an explicit member folder. */
export const workspaceEntryRequestSchema = z
  .object({
    folderPath: folderPathSchema,
    kind: workspaceEntryKindSchema,
    path: relativePathSchema,
  })
  .strict();

export const workspaceCreateEntryRequestSchema = z
  .object({
    folderPath: folderPathSchema,
    kind: workspaceEntryKindSchema,
    name: workspaceEntryNameSchema,
    /** Folder-relative parent; empty for the folder root. */
    parentPath: z.string().trim().max(4096),
  })
  .strict();

export const workspaceRenameEntryRequestSchema = z
  .object({
    folderPath: folderPathSchema,
    kind: workspaceEntryKindSchema,
    name: workspaceEntryNameSchema,
    path: relativePathSchema,
  })
  .strict();

/** A file or folder moving under its own name into another folder of the
 *  same project. Whether a folder would land inside itself is the server's
 *  rule. */
export const workspaceMoveEntryRequestSchema = z
  .object({
    folderPath: folderPathSchema,
    kind: workspaceEntryKindSchema,
    /** Folder-relative destination folder; empty for the folder root. */
    parentPath: z.string().max(4096),
    path: relativePathSchema,
  })
  .strict();

/** The created or renamed entry's settled folder-relative path. File
 *  routes answer with `name`, folder routes with `path`; both may carry
 *  extra detail such as an index warning. */
export const workspaceEntryPathResponseSchema = z
  .object({ name: relativePathSchema.optional(), path: relativePathSchema.optional() })
  .passthrough()
  .refine((body) => body.name !== undefined || body.path !== undefined, {
    message: 'name or path required',
  });

export const workspaceDeleteEntryResponseSchema = z
  .object({ alreadyGone: z.boolean().optional() })
  .passthrough();

export const documentTextSourceRequestSchema = z
  .object({
    folderPath: folderPathSchema,
    path: relativePathSchema,
  })
  .strict();

const documentTextSourceBaseSchema = {
  content: boundedSourceTextSchema,
  format: z.enum(['md', 'html', 'json', 'txt']),
  name: relativePathSchema,
  version: sourceVersionSchema,
};

export const documentTextSourceResponseSchema = z.union([
  z.object(documentTextSourceBaseSchema).strict(),
  z
    .object({
      ...documentTextSourceBaseSchema,
      content: z.literal(''),
      format: z.literal('txt'),
      error: z
        .object({
          code: z.literal('UNSUPPORTED_ENCODING'),
          message: z.string().trim().min(1).max(500),
        })
        .strict(),
    })
    .strict(),
]);

export const documentTextSourceFailureSchema = z
  .object({
    code: z.string().trim().min(1).max(64).optional(),
    error: z.string().trim().min(1).max(500),
  })
  .strict();

const genericFilePreviewBaseSchema = {
  name: relativePathSchema,
  size: z.number().finite().nonnegative().optional(),
};

export const genericFilePreviewResponseSchema = z.union([
  z
    .object({
      ...genericFilePreviewBaseSchema,
      content: boundedSourceTextSchema,
      kind: z.literal('text'),
      size: z.number().finite().nonnegative(),
      version: sourceVersionSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...genericFilePreviewBaseSchema,
      kind: z.enum([
        'binary',
        'too-large',
        'unreadable',
        'symlink',
        'special',
        'cloud-placeholder',
      ]),
      message: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
]);

export const documentTextSaveRequestSchema = z
  .object({
    baseVersion: sourceVersionSchema,
    content: boundedSourceTextSchema,
    folderPath: folderPathSchema,
    path: relativePathSchema,
  })
  .strict();

export const documentTextOverwriteRequestSchema = z
  .object({
    content: boundedSourceTextSchema,
    folderPath: folderPathSchema,
    overwrite: z.literal(true),
    path: relativePathSchema,
  })
  .strict();

export const documentTextSaveResponseSchema = z
  .object({
    content: boundedSourceTextSchema,
    format: z.enum(['json', 'md', 'txt']),
    indexWarning: z.string().trim().min(1).max(1_000).optional(),
    name: relativePathSchema,
    version: sourceVersionSchema,
  })
  .strict();

export const documentTextSaveFailureSchema = z
  .object({
    code: z.string().trim().min(1).max(64).optional(),
    currentVersion: sourceVersionSchema.nullable().optional(),
    error: z.string().trim().min(1).max(500),
  })
  .strict();

export type WorkspaceFilesWire = z.infer<typeof workspaceFilesSchema>;

/** Original JSON response of a file mutation, queried without replaying it. */
export const fileOperationReceiptSchema = z.object({
  status: z.number().int().min(200).max(599),
  body: z.unknown(),
}).strict();
