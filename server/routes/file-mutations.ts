import express from 'express';
import { sanitizeFilename } from '../file-paths.ts';
import { toSourcePath } from '../folder.ts';
import { detectFormat, detectViewerFormat } from '../format.ts';
import { guardExplicitFolder, sendError } from '../http.ts';
import { planRenameLinksAsync, type RenameEntry } from '../links.ts';
import { bundleRenameEntryAsync } from '../rename-helpers.ts';
import { deleteProjectFile, moveProjectFile } from '../project-file-mutations.ts';

export function mountFileMutationRoutes(app: express.Express): void {
  // Active-folder HTTP is only an adapter. The shared project mutation module
  // owns disk changes, link cascades, derived cleanup, file order, and index
  // completion for both UI and MCP callers.
  app.patch('/api/files/*', async (req, res) => {
    if (!(await guardExplicitFolder(req, res))) return;
    const oldName = (req.params as any)[0] as string;
    const requested = typeof req.body?.new_name === 'string' ? req.body.new_name.trim() : '';
    if (!requested) return res.status(400).json({ error: 'new_name required' });
    const oldFormat = detectViewerFormat(oldName);
    const oldStructuredFormat = detectFormat(oldName);
    let newName = requested;
    const requestedHasCompatibleExt = oldFormat
      ? hasCompatibleRenameExtension(oldStructuredFormat, oldFormat, newName)
      : opaqueRenameExtension(oldName) === opaqueRenameExtension(newName);
    if (!requestedHasCompatibleExt) {
      const oldExt = oldName.match(/\.[^./]+$/)?.[0] ?? '';
      newName += oldExt;
    }
    newName = renameTargetPath(oldName, newName);
    if (newName === oldName) return res.json({ name: oldName, linksUpdated: 0 });
    try {
      const result = await moveProjectFile(toSourcePath(oldName), toSourcePath(newName), {
        cascade: req.body?.cascade !== false,
        allowOpaque: true,
      });
      res.json({
        name: newName,
        linksUpdated: result.linksUpdated,
        indexWarning: result.indexWarning,
      });
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  app.delete('/api/files/*', async (req, res) => {
    if (!(await guardExplicitFolder(req, res))) return;
    const name = (req.params as any)[0] as string;
    try {
      const result = await deleteProjectFile(toSourcePath(name), { allowOpaque: true });
      res.json({ alreadyGone: result.alreadyGone, indexWarning: result.indexWarning });
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  app.post('/api/rename-preview', async (req, res) => {
    const kind = req.body?.kind === 'folder' ? 'folder' : 'file';
    const oldPath = typeof req.body?.old === 'string' ? req.body.old.trim() : '';
    const newPath = typeof req.body?.new === 'string' ? req.body.new.trim() : '';
    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'old and new required' });
    }
    if (oldPath === newPath) {
      return res.json({ files: 0, links: 0 });
    }
    const renames: RenameEntry[] = [{ kind, old: oldPath, new: newPath }];
    if (kind === 'file') {
      const bundle = await bundleRenameEntryAsync(oldPath, newPath, 'pre');
      if (bundle) renames.push(bundle);
    }
    try {
      const plan = await planRenameLinksAsync(renames);
      res.json({
        files: plan.length,
        links: plan.reduce((total, entry) => total + entry.changes, 0),
      });
    } catch (err: unknown) {
      sendError(res, err);
    }
  });
}

function opaqueRenameExtension(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  const lastDot = base.lastIndexOf('.');
  return lastDot > 0 ? base.slice(lastDot).toLocaleLowerCase() : '';
}

export function hasCompatibleRenameExtension(
  oldStructuredFormat: ReturnType<typeof detectFormat>,
  oldFormat: NonNullable<ReturnType<typeof detectViewerFormat>>,
  requestedName: string,
): boolean {
  if (!oldStructuredFormat) return detectViewerFormat(requestedName) === oldFormat;
  return oldStructuredFormat === 'json' || oldStructuredFormat === 'txt'
    ? detectFormat(requestedName) === oldStructuredFormat
    : detectFormat(requestedName) !== null;
}

function renameTargetPath(oldName: string, requested: string): string {
  const normalizedRequest = requested.replace(/\\/g, '/');
  if (normalizedRequest.includes('/')) return sanitizeFilename(normalizedRequest);
  const lastSlash = oldName.lastIndexOf('/');
  const parent = lastSlash >= 0 ? oldName.slice(0, lastSlash + 1) : '';
  return sanitizeFilename(parent + normalizedRequest);
}
