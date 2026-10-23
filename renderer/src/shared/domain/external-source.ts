/**
 * An external file: one outside the project that the reader dropped on the
 * document pane to read in place, without copying it.
 *
 * It travels as an ordinary `SourceReference` so tabs, history, and Agent
 * context need no second identity. Its `folderPath` is a marker carrying the
 * read grant's token, never a folder, so anything that expects a project
 * folder refuses it rather than reading elsewhere; its `path` is the file's
 * absolute path, which the tab shows and the Agent reads.
 */
import type { SourceReference } from './source-reference';

const EXTERNAL_FOLDER_PREFIX = 'external:';

export function externalSource(token: string, absolutePath: string): SourceReference {
  return { folderPath: `${EXTERNAL_FOLDER_PREFIX}${token}`, path: absolutePath };
}

/** The read grant behind an external source, or null for a project source. */
export function externalFileToken(source: SourceReference): string | null {
  return source.folderPath.startsWith(EXTERNAL_FOLDER_PREFIX)
    ? source.folderPath.slice(EXTERNAL_FOLDER_PREFIX.length) || null
    : null;
}

export function isExternalSource(source: SourceReference): boolean {
  return externalFileToken(source) !== null;
}
