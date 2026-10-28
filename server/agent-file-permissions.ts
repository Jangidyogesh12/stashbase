import fs from 'node:fs';
import path from 'node:path';

/** Whether a file-change grant remains entirely inside the opened folder. */
export function isWorkspaceFileChange(
  params: Record<string, unknown> | undefined,
  cwd: string | null,
): boolean {
  return isPathWithinWorkspace(typeof params?.grantRoot === 'string' ? params.grantRoot : '', cwd);
}
/** Edit mode accepts ordinary StashBase text edits and blank-note creation in the folder. */
export function isStashbaseWorkspaceEdit(
  approval: { input: Record<string, unknown> },
  cwd: string | null,
): boolean {
  const tool = approval.input.tool;
  const args = approval.input.arguments as Record<string, unknown> | undefined;
  return String(approval.input.server ?? '').toLowerCase() === 'stashbase'
    && (tool === 'write_file' || tool === 'edit_file' || tool === 'create_interactive_note')
    && isPathWithinWorkspace(typeof args?.path === 'string' ? args.path : '', cwd);
}

/** Whether `candidate` resolves inside the opened folder, following links. */
export function isPathWithinWorkspace(candidate: string, cwd: string | null): boolean {
  if (!cwd || !candidate) return false;
  const workspace = resolvedExistingPath(cwd);
  const target = resolvedExistingPath(candidate);
  if (!workspace || !target) return false;
  const relative = path.relative(workspace, target);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolvedExistingPath(candidate: string): string | null {
  const absolute = path.resolve(candidate);
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return null;
    existing = parent;
  }
  try {
    return path.resolve(fs.realpathSync.native(existing), path.relative(existing, absolute));
  } catch {
    return null;
  }
}
