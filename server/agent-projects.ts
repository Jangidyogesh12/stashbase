/** Explicit MCP project creation. Create and register an authorized directory;
 * opening it and starting a conversation use the ordinary project entry flow. */
import fs from 'node:fs';
import {
  assertProjectFolderAvailableAsync,
  getFolderHome,
  registeredFolderRootsAsync,
  registerProjectFolderAsync,
  validateFolderName,
} from './folder.ts';
import { filesystemPath } from './filesystem-path.ts';
import { noteTreeChanged } from './watcher.ts';
import { syncFolderNow } from './state.ts';
import { logger, errorMessage } from './log.ts';

const log = logger('agent-projects');

export interface CreateProjectInput {
  name: unknown;
  location?: unknown;
}

export interface CreateProjectResult {
  path: string;
  name: string;
  registered: true;
  note: string;
}

export type CreateProjectTargetResolution =
  | { ok: true; parent: string; target: string; name: string; owner: string }
  | { ok: false; message: string };

function operationError(message: string, status: number, code?: string): Error {
  const err = new Error(message) as Error & { status: number; code?: string };
  err.status = status;
  if (code) err.code = code;
  return err;
}

/** Request-path target resolution with async mounted-volume identity checks. */
export async function resolveCreateProjectTargetAsync(
  name: unknown,
  location: unknown,
  deps: { folderHome: string; memberRoots: readonly string[] },
): Promise<CreateProjectTargetResolution> {
  if (typeof name !== 'string' || !name.trim()) return { ok: false, message: '`name` is required' };
  const trimmed = name.trim();
  const bad = validateFolderName(trimmed);
  if (bad) return { ok: false, message: `invalid project name: ${bad}` };

  let parent = deps.folderHome;
  if (location != null && `${location}`.trim() !== '') {
    if (typeof location !== 'string') return { ok: false, message: '`location` must be an absolute directory path' };
    const raw = location;
    if (!filesystemPath.isAbsolute(raw)) return { ok: false, message: '`location` must be an absolute directory path' };
    const abs = filesystemPath.absolute(raw);
    parent = abs;
  }
  const owner = await owningRootAsync(parent, [deps.folderHome, ...deps.memberRoots]);
  if (!owner) {
    return { ok: false, message: '`location` must be the folder home, inside it, or inside a project folder' };
  }
  return { ok: true, parent, target: filesystemPath.join(parent, trimmed), name: trimmed, owner };
}

async function owningRootAsync(abs: string, roots: readonly string[]): Promise<string | null> {
  let owner: string | null = null;
  for (const root of roots) {
    try {
      if (!(await filesystemPath.containsAsync(root, abs))) continue;
      if (!owner || await filesystemPath.containsAsync(owner, root)) owner = filesystemPath.absolute(root);
    } catch {
      // A malformed persisted root cannot authorize filesystem access.
    }
  }
  return owner;
}

export interface CreateProjectDeps {
  folderHome(): string;
  memberRoots(): string[] | Promise<string[]>;
  /** Register into project membership (the sidebar list source). */
  register(abs: string): void | Promise<void>;
  noteTreeChanged(): void;
  /** Bind + reconcile the new folder in the background. */
  syncFolder(abs: string): Promise<unknown>;
  assertAvailable(abs: string): void | Promise<void>;
}

const productionDeps: CreateProjectDeps = {
  folderHome: getFolderHome,
  memberRoots: registeredFolderRootsAsync,
  register: registerProjectFolderAsync,
  noteTreeChanged,
  syncFolder: (abs) => syncFolderNow(abs, { reason: 'create_project' }),
  assertAvailable: assertProjectFolderAvailableAsync,
};

export async function createProjectFolder(
  input: CreateProjectInput,
  deps: CreateProjectDeps = productionDeps,
): Promise<CreateProjectResult> {
  const folderHome = deps.folderHome();
  const resolved = await resolveCreateProjectTargetAsync(input.name, input.location, {
    folderHome,
    memberRoots: await deps.memberRoots(),
  });
  if (!resolved.ok) throw operationError(resolved.message, 400, 'INVALID_PROJECT');
  const { owner } = resolved;

  let parentStat: fs.Stats;
  let target: string;
  try {
    // Creating the default home is explicit; introduction seeding belongs to startup.
    if (owner === filesystemPath.absolute(folderHome)) await fs.promises.mkdir(folderHome, { recursive: true });
    const parentRel = await filesystemPath.relativeAsync(owner, resolved.parent);
    const targetRel = await filesystemPath.relativeAsync(owner, resolved.target);
    if (parentRel == null || targetRel == null) throw new Error('path is outside the owned folder scope');
    const parent = await filesystemPath.resolveUnderAsync(owner, parentRel, { access: 'existing', label: 'location' });
    target = await filesystemPath.resolveUnderAsync(owner, targetRel, { access: 'creatable', label: 'project path' });
    parentStat = await fs.promises.stat(parent);
  } catch {
    throw operationError('`location` does not exist or escapes its owned folder through a symlink', 400, 'INVALID_PROJECT');
  }
  if (!parentStat.isDirectory()) throw operationError('`location` is not a directory', 400, 'INVALID_PROJECT');
  await deps.assertAvailable(target);

  try {
    await fs.promises.mkdir(target);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') {
      throw operationError(`a folder named "${resolved.name}" already exists at that location`, 409, 'FOLDER_EXISTS');
    }
    throw operationError(`could not create the project folder: ${errorMessage(err)}`, 500);
  }

  // Membership is the commit record. Persist it before starting background
  // work so a config/removal failure can retire the still-empty directory.
  let created: fs.Stats | undefined;
  try {
    created = await fs.promises.lstat(target);
    await deps.register(target);
  } catch (err) {
    try {
      const current = await fs.promises.lstat(target);
      if (created?.isDirectory() && current.isDirectory() && created.ino !== 0
        && current.dev === created.dev && current.ino === created.ino) {
        await fs.promises.rmdir(target);
      }
    } catch { /* Preserve non-empty folders and paths whose identity is uncertain. */ }
    throw err;
  }
  // Agent Instructions are app metadata edited from the Agent-panel toolbar, so
  // project creation never writes an instruction file into the user's folder.
  deps.noteTreeChanged();
  void Promise.resolve()
    .then(() => deps.syncFolder(target))
    .catch((err: unknown) => log.warn(`create_project: background bind/sync failed for ${target}:`, err));

  return {
    path: target,
    name: resolved.name,
    registered: true,
    note: 'Project created and registered. Open it to start a chat there.',
  };
}
