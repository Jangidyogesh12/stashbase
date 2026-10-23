import type { AgentWorkspaceRuntime } from '@/features/agent/application/workspace-runtime';
import { contextItemKey, passageContextItem } from '@/features/agent/domain/context';
import { fileContextItem } from '@/features/agent/domain/draft-context';
import { agentScopesEqual, type AgentScope } from '@/features/agent/domain/session';
import { isExternalSource } from '@/shared/domain/external-source';
import type { SourceReference } from '@/shared/domain/source-reference';

/** Binds a passage of a document to the chat in its folder and moves the
 *  reader's caret to that chat's composer. A passage validates only against
 *  its own folder, so a chat about another folder gives way to a new one. An
 *  external file belongs to no folder, so its passage goes to the chat
 *  beside it. */
export function askAbout(
  workspace: AgentWorkspaceRuntime,
  source: SourceReference,
  quote: string,
): void {
  const item = passageContextItem(source, quote);
  if (!item) return;
  const active = workspace.activeSession();
  const activeScope = active.store.getState().scope;
  let session = active;
  if (isExternalSource(source)) {
    if (activeScope.kind !== 'folder') session = workspace.newChat();
  } else {
    const scope: AgentScope = { kind: 'folder', path: source.folderPath };
    if (!agentScopesEqual(activeScope, scope)) session = workspace.newChat(undefined, scope);
  }
  session.addContext(item);
  session.requestComposerFocus();
}

/** Binds a file the reader dropped on the workspace to the chat beside it.
 *  The drop is the reader opening the file, so it becomes context without a
 *  click, and neither the pane nor the caret moves. Answers the chat it went
 *  to, so closing the file's tab can take it back. */
export function attachDroppedSource(
  workspace: AgentWorkspaceRuntime,
  source: SourceReference,
): string {
  const session = workspace.activeSession();
  session.addContext(fileContextItem(source, true));
  return session.id;
}

/** Takes back a dropped file's card when its tab closes. A card the reader
 *  bound again by hand stays: what was added by itself leaves by itself. */
export function releaseDroppedSource(
  workspace: AgentWorkspaceRuntime,
  sessionId: string,
  source: SourceReference,
): void {
  const session = workspace.session(sessionId);
  if (!session) return;
  const key = contextItemKey(fileContextItem(source));
  const dropped = session.store
    .getState()
    .context.some((item) => item.kind === 'source' && item.dropped && contextItemKey(item) === key);
  if (dropped) session.removeContext(key);
}
