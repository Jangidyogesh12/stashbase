/**
 * Read grants for external files: files outside the window's project that the
 * reader dropped on the document pane to look at without copying.
 *
 * Only the Electron main process registers a grant, from the path preload read
 * off a dropped `File`. A grant names one canonical file for one window. It
 * never widens a project, MCP, upload, or Agent tool boundary, and nothing
 * here prepares, converts, or indexes the file. Reads re-check the canonical
 * path each time, so a component later swapped for a symlink fails instead of
 * redirecting the grant. Switching the window's project or closing the window
 * revokes every grant it held.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isExternalFileViewerFormat, type ViewerFormat } from '../shared/file-formats.ts';
import type { GenericFilePreview } from '../shared/project-files.ts';
import type { ExternalFileOpenResult } from '../shared/protocols/http/external-files.ts';
import { MAX_TEXT_READ_BYTES, readFileBytesBoundedAsync } from './active-file-operations.ts';
import { writeFileAtomic, writeFileAtomicAsync } from './atomic-write.ts';
import { isDevelopmentRuntime } from './development-runtime.ts';
import { filesystemPath } from './filesystem-path.ts';
import { getCurrentFolder, onClose, onSwitch, registeredRootForAbsAsync } from './folder.ts';
import { detectViewerFormat, isKnownBinaryFile } from './format.ts';
import { decodeGenericText } from './generic-file-preview.ts';
import { isSpreadsheetFile, spreadsheetFilePreview } from './spreadsheet-preview.ts';
import { isCloudPlaceholderName } from './indexable.ts';
import { preserveTextSourceFormat } from './markdown-source-format.ts';
import { decodeTextSnapshotBytes } from './text-decoding.ts';
import { fileChanged, textVersion } from './text-file-transaction.ts';

/** Where a development server that Electron did not start leaves its
 *  registration token. `electron/main-probe.cjs` reads the same file. */
export const DEVELOPMENT_REGISTRATION_TOKEN_FILE = path.join(
  os.homedir(),
  '.stashbase',
  'dev-external-file-token',
);

/**
 * The secret main proves it is main with when it registers a dropped file.
 * Electron hands a server it starts its own token. A development server
 * started on its own (`pnpm dev`) instead writes a fresh one to an owner-only
 * file, which main reads when it reuses that server. Without either, nothing
 * can register.
 */
export function externalFileRegistrationToken(env: NodeJS.ProcessEnv = process.env): string {
  const fromMain = env.STASHBASE_EXTERNAL_FILE_TOKEN;
  if (fromMain) {
    // Read once and forgotten: an agent runtime the server spawns inherits its
    // environment, and with the token it could grant itself any file.
    delete env.STASHBASE_EXTERNAL_FILE_TOKEN;
    return fromMain;
  }
  if (!isDevelopmentRuntime(env)) return '';
  const token = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(DEVELOPMENT_REGISTRATION_TOKEN_FILE), { mode: 0o700, recursive: true });
    writeFileAtomic(DEVELOPMENT_REGISTRATION_TOKEN_FILE, token, { mode: 0o600 });
    return token;
  } catch {
    return '';
  }
}

export interface ExternalFileGrant {
  readonly token: string;
  readonly windowId: string;
  /** Canonical path every read is served from. */
  readonly realPath: string;
  /** The spelling the reader dropped: shown in the tab and given to the Agent. */
  readonly path: string;
  readonly name: string;
  readonly format: ViewerFormat;
}

/** A window that keeps dropping files without closing them stops here. */
export const MAX_EXTERNAL_FILE_GRANTS_PER_WINDOW = 256;

const grants = new Map<string, ExternalFileGrant>();
const tokensByWindowFile = new Map<string, string>();

function windowFileKey(windowId: string, realPath: string): string {
  return `${windowId}\0${filesystemPath.identity(realPath)}`;
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
}

function refused(name: string, reason: Extract<ExternalFileOpenResult, { kind: 'refused' }>['reason']): ExternalFileOpenResult {
  return { kind: 'refused', name, reason };
}

/** Generic files open only as UTF-8 text; a binary one must be copied. */
async function isTextFile(realPath: string, size: number): Promise<boolean> {
  if (size > MAX_TEXT_READ_BYTES) return true;
  try {
    return decodeGenericText(await readFileBytesBoundedAsync(realPath)) !== null;
  } catch {
    return false;
  }
}

/**
 * Resolves one dropped path for `windowId`: the project's own source when the
 * file already lives in the window's project, a grant when it can open in
 * place, or the reason it cannot.
 */
export async function registerExternalFile(windowId: string, droppedPath: string): Promise<ExternalFileOpenResult> {
  const name = path.basename(droppedPath) || droppedPath;
  const projectRoot = getCurrentFolder();
  if (!projectRoot) return refused(name, 'no-project');
  if (!filesystemPath.isAbsolute(droppedPath)) return refused(name, 'unavailable');

  let realPath: string;
  let stat: fs.Stats;
  try {
    realPath = await fs.promises.realpath(droppedPath);
    stat = await fs.promises.stat(realPath);
  } catch {
    return refused(name, 'unavailable');
  }
  if (stat.isDirectory()) return refused(name, 'directory');
  if (!stat.isFile() || isCloudPlaceholderName(path.basename(realPath))) return refused(name, 'unavailable');

  let projectRealRoot: string | null = null;
  try { projectRealRoot = await fs.promises.realpath(projectRoot); } catch { /* treated as outside */ }
  const projectPath = projectRealRoot ? await filesystemPath.relativeAsync(projectRealRoot, realPath) : null;
  const format: ViewerFormat = detectViewerFormat(realPath) ?? 'generic';
  if (projectPath) return { format, kind: 'project', path: projectPath };
  // A file of another registered project opens as that project's, read-only
  // here like any other project's source; its saves and index stay its own.
  const owner = await registeredRootForAbsAsync(realPath);
  if (owner) {
    let ownerReal: string | null = null;
    try { ownerReal = await fs.promises.realpath(owner); } catch { /* not that project's file then */ }
    const ownerPath = ownerReal ? await filesystemPath.relativeAsync(ownerReal, realPath) : null;
    if (ownerPath) return { folderPath: owner, format, kind: 'project', path: ownerPath };
  }

  if (!isExternalFileViewerFormat(format)) return refused(name, 'copy-required');
  if (format === 'generic' && !isSpreadsheetFile(realPath) && (isKnownBinaryFile(realPath) || !(await isTextFile(realPath, stat.size)))) {
    return refused(name, 'copy-required');
  }

  const key = windowFileKey(windowId, realPath);
  const existing = tokensByWindowFile.get(key);
  const current = existing ? grants.get(existing) : undefined;
  if (current) return { format: current.format, kind: 'external', name: current.name, path: current.path, token: current.token };

  // The window may have left its project while this was resolved; a grant
  // made now would outlive the revocation that move already ran.
  if (getCurrentFolder() !== projectRoot) return refused(name, 'no-project');
  const held = [...grants.values()].filter((grant) => grant.windowId === windowId).length;
  if (held >= MAX_EXTERNAL_FILE_GRANTS_PER_WINDOW) return refused(name, 'unavailable');
  const grant: ExternalFileGrant = {
    format,
    name,
    path: filesystemPath.absolute(droppedPath),
    realPath,
    token: crypto.randomBytes(24).toString('base64url'),
    windowId,
  };
  grants.set(grant.token, grant);
  tokensByWindowFile.set(key, grant.token);
  return { format, kind: 'external', name, path: grant.path, token: grant.token };
}

/** The grant behind `token`. A window may only read its own grants; asset
 *  requests carry no window identity, so they pass `null` and the token alone
 *  is the capability. */
export function externalFileGrant(token: string, windowId: string | null): ExternalFileGrant | null {
  const grant = grants.get(token);
  if (!grant) return null;
  return windowId === null || grant.windowId === windowId ? grant : null;
}

export function revokeExternalFile(token: string, windowId: string): boolean {
  const grant = grants.get(token);
  if (!grant || grant.windowId !== windowId) return false;
  grants.delete(token);
  const key = windowFileKey(grant.windowId, grant.realPath);
  if (tokensByWindowFile.get(key) === token) tokensByWindowFile.delete(key);
  return true;
}

export function revokeWindowExternalFiles(windowId: string): void {
  for (const grant of [...grants.values()]) {
    if (grant.windowId === windowId) revokeExternalFile(grant.token, windowId);
  }
}

let lifecycleBound = false;

/** Leaving a project or closing a window drops every grant it held. */
export function bindExternalFileLifecycle(): void {
  if (lifecycleBound) return;
  lifecycleBound = true;
  onSwitch((_root, windowId) => revokeWindowExternalFiles(windowId));
  onClose((_root, windowId) => revokeWindowExternalFiles(windowId));
}

/** The granted file as it is now, or null when it is gone or no longer the
 *  same canonical regular file. */
export async function resolveExternalFileAsync(grant: ExternalFileGrant): Promise<string | null> {
  try {
    const current = await fs.promises.realpath(grant.realPath);
    if (!filesystemPath.equal(current, grant.realPath)) return null;
    const stat = await fs.promises.stat(current);
    return stat.isFile() ? current : null;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(errorCode(error))) return null;
    throw error;
  }
}

/** The same stat identity project assets use for reloads. */
export async function externalFileVersionAsync(grant: ExternalFileGrant): Promise<string | null> {
  const target = await resolveExternalFileAsync(grant);
  if (!target) return null;
  try {
    const st = await fs.promises.stat(target, { bigint: true });
    return st.isFile() ? `stat:${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}` : null;
  } catch {
    return null;
  }
}

export type ExternalTextSnapshot =
  | { content: string; version: string }
  | { content: ''; version: string; error: { code: 'UNSUPPORTED_ENCODING'; message: string } };

/** A bounded text read with the version of exactly those bytes. */
export async function readExternalTextAsync(grant: ExternalFileGrant): Promise<ExternalTextSnapshot | null> {
  const target = await resolveExternalFileAsync(grant);
  if (!target) return null;
  const bytes = await readFileBytesBoundedAsync(target);
  const version = textVersion(bytes);
  try {
    return { content: decodeTextSnapshotBytes(grant.name, bytes), version };
  } catch (error) {
    if (errorCode(error) !== 'UNSUPPORTED_ENCODING') throw error;
    return {
      content: '',
      error: { code: 'UNSUPPORTED_ENCODING', message: error instanceof Error ? error.message : String(error) },
      version,
    };
  }
}

/** The bounded read-only text a generic file shows, keyed by its dropped path. */
export async function readExternalGenericPreviewAsync(grant: ExternalFileGrant, signal?: AbortSignal): Promise<GenericFilePreview | null> {
  const target = await resolveExternalFileAsync(grant);
  if (!target) return null;
  const stat = await fs.promises.stat(target);
  if (stat.size > MAX_TEXT_READ_BYTES) return { kind: 'too-large', name: grant.path, size: stat.size };
  const bytes = await readFileBytesBoundedAsync(target);
  if (isSpreadsheetFile(target)) return spreadsheetFilePreview(bytes, grant.path, signal);
  const content = decodeGenericText(bytes);
  if (content === null) return { kind: 'binary', name: grant.path, size: stat.size };
  const version = await externalFileVersionAsync(grant);
  return { content, kind: 'text', name: grant.path, size: stat.size, ...(version ? { version } : {}) };
}

/** Formats an external file can be edited and saved in, as a project file can. */
export function isEditableExternalFile(grant: ExternalFileGrant): boolean {
  return grant.format === 'md' || grant.format === 'txt' || grant.format === 'json' || grant.format === 'csv';
}

/** Where a save of the grant's file lands: the file itself, or, when it is
 *  gone and the reader asked to write it back, its original place, provided
 *  the folder that held it is still that same folder. */
async function externalWriteTargetAsync(grant: ExternalFileGrant, recreate: boolean): Promise<string | null> {
  const existing = await resolveExternalFileAsync(grant);
  if (existing || !recreate) return existing;
  try {
    await fs.promises.lstat(grant.realPath);
    return null;
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') return null;
  }
  try {
    const parent = path.dirname(grant.realPath);
    return filesystemPath.equal(await fs.promises.realpath(parent), parent) ? grant.realPath : null;
  } catch {
    return null;
  }
}

async function readExternalSnapshotAsync(target: string, name: string): Promise<{ content: string; version: string } | null> {
  try {
    const bytes = await readFileBytesBoundedAsync(target);
    return { content: decodeTextSnapshotBytes(name, bytes), version: textVersion(bytes) };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

const externalWrites = new Map<string, Promise<unknown>>();

/**
 * Saves the reader's text to the grant's file against the version they read,
 * the way a project save does: the source's BOM, line endings, and
 * permissions survive, and a file changed since is a conflict rather than
 * overwritten. Without a base version the write is the reader's explicit
 * choice to replace, or recreate, what is on disk. Nothing is indexed.
 */
export async function saveExternalTextAsync(
  grant: ExternalFileGrant,
  content: string,
  baseVersion: string | undefined,
): Promise<{ content: string; version: string } | null> {
  const previousWrite = externalWrites.get(grant.token) ?? Promise.resolve();
  const write = previousWrite.catch(() => undefined).then(async () => {
    const target = await externalWriteTargetAsync(grant, baseVersion === undefined);
    if (!target) return null;
    const previous = await readExternalSnapshotAsync(target, grant.name);
    const saved = preserveTextSourceFormat(previous?.content ?? '', content, {
      keepUnchangedLineEndings: grant.format === 'csv',
    });
    if (previous?.content === saved) return previous;
    if (baseVersion !== undefined && previous?.version !== baseVersion) throw fileChanged(previous?.version ?? null);
    const mode = await fs.promises.stat(target).then((stat) => stat.mode & 0o777, () => undefined);
    await writeFileAtomicAsync(target, Buffer.from(saved, 'utf8'), {
      beforeRename: async () => {
        const current = await readExternalSnapshotAsync(target, grant.name);
        if ((current?.version ?? null) !== (previous?.version ?? null)) throw fileChanged(current?.version ?? null);
      },
      mode,
    });
    return { content: saved, version: textVersion(saved) };
  });
  externalWrites.set(grant.token, write);
  try {
    return await write;
  } finally {
    if (externalWrites.get(grant.token) === write) externalWrites.delete(grant.token);
  }
}

/** Test seam: forget every grant. */
export function clearExternalFileGrants(): void {
  grants.clear();
  tokensByWindowFile.clear();
}
