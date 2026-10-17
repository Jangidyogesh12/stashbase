/** Codex history follows the native thread cwd. */
import { deleteCodexSession, getCodexSessionMessages, listCodexSessions, renameCodexSession } from './codex-history.ts';
import type { AgentHistoryActions } from './agent-contract.ts';

export function codexHistoryActions(): AgentHistoryActions {
  return {
    list: listCodexSessions,
    messages: getCodexSessionMessages,
    replay: async (id, folder) => ({ protocol: 2, messages: await getCodexSessionMessages(id, folder), effort: null }),
    rename: renameCodexSession,
    remove: deleteCodexSession,
  };
}
