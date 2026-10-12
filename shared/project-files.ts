import type { z } from 'zod';
import type {
  genericFilePreviewResponseSchema,
  WORKSPACE_ENTRY_AVAILABILITIES,
  WORKSPACE_FILE_KINDS,
} from './protocols/http/files.ts';

/**
 * File-shaped contracts the server reports about a folder's contents.
 *
 * Workspace listings report visible filesystem entries truthfully. A
 * `generic` file is present in the workbench but deliberately outside Search
 * and automatic Agent context. Entry metadata records cases where the source
 * can be identified but must not be read or mutated through normal document
 * flows.
 */

export type WorkspaceFileKind = (typeof WORKSPACE_FILE_KINDS)[number];
export type WorkspaceEntryAvailability = (typeof WORKSPACE_ENTRY_AVAILABILITIES)[number];

/**
 * One file resolved for Agent retrieval. `sourcePath` is what the user sees
 * and `readPath` is what actually gets read — they differ for a converted
 * source, where the readable text lives in a derived note. `available` and
 * `reason` carry a refusal in-band so a caller reports why a file could not
 * be supplied rather than failing the whole request.
 */
export interface AgentContextFile {
  /** Absolute source spelling exposed to MCP/file tools. */
  path: string;
  /** Display label of the member folder containing the source. */
  folder: string;
  /** Folder-relative visible source path (`paper.pdf`). */
  sourcePath: string;
  /** Path the agent should read first (folder-relative for direct text; an
   *  absolute app-data path for extracted PDF/DOCX text). */
  readPath: string;
  kind: 'direct' | 'derived';
  sourceFormat: string;
  available: boolean;
  reason: string;
}

export type GenericFilePreview = z.infer<typeof genericFilePreviewResponseSchema>;

/** Upload reports per file rather than failing the batch: one rejected
 *  file must not discard the rest of a multi-file drop. */
export interface UploadResultEntry {
  file: string;
  error?: string;
}

export interface UploadResult {
  files: UploadResultEntry[];
}
