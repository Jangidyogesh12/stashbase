import { AsyncLocalStorage } from 'node:async_hooks';
import { attributedAgentSession, type AttributedAgentId } from './agent-session-registry.ts';
import { filesystemPath } from './filesystem-path.ts';
import { ProjectOperationError } from './project-operations/errors.ts';

// Absence is an external caller; null is an attributed Chat with no project.
const requestScope = new AsyncLocalStorage<{ folder: string | null; runtime: AttributedAgentId }>();
const requestOrigin = new AsyncLocalStorage<'mcp' | 'http'>();

export function withAgentProjectScope<T>(sessionId: string | undefined, work: () => T, origin: 'mcp' | 'http' = 'http'): T {
  if (sessionId == null) return requestOrigin.run(origin, work);
  const session = attributedAgentSession(sessionId);
  if (!session) throw new ProjectOperationError('The Chat session is no longer available.', 409, 'SESSION_UNAVAILABLE');
  return requestScope.run({ folder: session.boundFolder(), runtime: session.agentId }, work);
}

/** Transport hints never establish agent identity or change access. Only the
 * live session already accepted for project scope supplies a runtime. */
export function projectFileOperationOrigin(): { origin: 'agent' | 'mcp' | 'http'; runtime?: AttributedAgentId } {
  const session = requestScope.getStore();
  return session ? { origin: 'agent', runtime: session.runtime } : { origin: requestOrigin.getStore() ?? 'http' };
}

/** Search and index operations must select the conversation's exact namespace. */
export function assertProjectScope(folder: string): void {
  assertScopeAllows(folder, filesystemPath.equal);
}

/** A file remains inside its parent project even when a child folder is also
 * registered. Registration chooses its owner; it does not change containment. */
export function assertProjectPath(sourcePath: string): void {
  assertScopeAllows(sourcePath, filesystemPath.contains);
}

function assertScopeAllows(target: string, allows: (root: string, target: string) => boolean): void {
  const scope = requestScope.getStore();
  if (!scope) return;
  if (!scope.folder) {
    throw new ProjectOperationError('Open a project before accessing its files.', 400, 'FOLDER_REQUIRED');
  }
  if (!allows(scope.folder, target)) {
    throw new ProjectOperationError('Files must stay in the conversation project.', 403, 'PROJECT_SCOPE_MISMATCH');
  }
}
