/** Shared text snapshots and per-source write transactions for saves and link rewrites. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafeAsync } from './file-paths.ts';
import { filesystemPath } from './filesystem-path.ts';
import { requireCurrentFolder, runWithFolderRoot } from './folder.ts';
import { readFileBytesBoundedAsync, saveTextAsync } from './active-file-operations.ts';
import { decodeTextSnapshotBytes } from './text-decoding.ts';

export interface TextSnapshot { content: string; version: string }
const writes = new Map<string, Promise<void>>();

async function writeIdentity(target: string): Promise<string> {
  // Atomic replacement owns a directory entry, not the old file's inode.
  // Resolve parent aliases while preserving any not-yet-created suffix.
  const suffix = [path.basename(target)];
  let parent = path.dirname(target);
  for (;;) {
    try { return filesystemPath.identityAsync(path.join(await fs.promises.realpath(parent), ...suffix)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(parent) === parent) throw error;
      suffix.unshift(path.basename(parent));
      parent = path.dirname(parent);
    }
  }
}

export function textVersion(bytes: string | Uint8Array): string {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

/** Content and its version always describe the same bounded read. */
export async function readTextSnapshotAsync(name: string): Promise<TextSnapshot | null> {
  const target = await resolveSafeAsync(name, 'creatable');
  try {
    const bytes = await readFileBytesBoundedAsync(target);
    return { content: decodeTextSnapshotBytes(name, bytes), version: textVersion(bytes) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function fileChanged(currentVersion: string | null): Error {
  return Object.assign(new Error('file changed on disk; reload before saving'), {
    code: 'FILE_CHANGED', currentVersion,
  });
}

/** Pin the folder before yielding; equivalent source spellings share one queue. */
export async function withTextFileTransaction<T>(name: string, operation: () => Promise<T>): Promise<T> {
  return runWithFolderRoot(requireCurrentFolder(), async () => {
    const target = await resolveSafeAsync(name, 'creatable');
    const key = await writeIdentity(target);
    const previous = writes.get(key) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    writes.set(key, pending);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (writes.get(key) === pending) writes.delete(key);
    }
  });
}

/** Called inside the source transaction. Recheck external edits after staging. */
export async function replaceTextSnapshotAsync(name: string, content: string, expectedVersion: string | null): Promise<TextSnapshot> {
  await saveTextAsync(name, content, async () => {
    const current = await readTextSnapshotAsync(name);
    if ((current?.version ?? null) !== expectedVersion) throw fileChanged(current?.version ?? null);
  });
  return { content, version: textVersion(content) };
}
