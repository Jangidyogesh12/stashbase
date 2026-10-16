import type { AgentScopeEnvironment } from '@/features/agent/domain/context';

import { agentScopesEqual, type AgentId, type AgentScope, type AgentSessionPhase } from './session';

export interface AgentTabState {
  agent: AgentId;
  blank: boolean;
  hasContent: boolean;
  hasDraft?: boolean;
  status?: string | null;
  id: string;
  lastModified: number;
  nativeSessionId: string | null;
  phase: AgentSessionPhase;
  scope: AgentScope;
  title: string;
}

/** What the Agent area shows: the active chat, or the project's scheduled
 *  tasks in its place. Opening any chat brings the chat back. */
type AgentWorkspaceSurface = 'chat' | 'scheduled-tasks';

export interface AgentWorkspaceState {
  activeId: string;
  surface: AgentWorkspaceSurface;
  visits: string[];
  visitIndex: number;
  /** The window folder's live listing and preparation state, or null while
   *  no folder is selected or the shell has not published it yet. */
  scopeEnvironment: AgentScopeEnvironment | null;
  disposed: boolean;
  tabs: AgentTabState[];
}

export function createAgentWorkspaceState(activeId: string): AgentWorkspaceState {
  return {
    activeId,
    surface: 'chat',
    visits: [activeId],
    visitIndex: 0,
    disposed: false,
    scopeEnvironment: null,
    tabs: [],
  };
}

function tabsEqual(left: AgentTabState, right: AgentTabState): boolean {
  return (Object.keys(right) as Array<keyof AgentTabState>).every((key) =>
    Object.is(left[key], right[key]),
  );
}

export function upsertAgentTab(
  state: AgentWorkspaceState,
  tab: AgentTabState,
): AgentWorkspaceState {
  const current = state.tabs.find((candidate) => candidate.id === tab.id);
  if (current && tabsEqual(current, tab)) return state;
  return {
    ...state,
    tabs: state.tabs.some((candidate) => candidate.id === tab.id)
      ? state.tabs.map((candidate) => (candidate.id === tab.id ? tab : candidate))
      : [...state.tabs, tab],
  };
}

export function activateAgentTab(state: AgentWorkspaceState, id: string): AgentWorkspaceState {
  if (state.activeId === id)
    return state.surface === 'chat' ? state : { ...state, surface: 'chat' };
  return {
    ...state,
    activeId: id,
    surface: 'chat',
    visits: [...state.visits.slice(0, state.visitIndex + 1), id].slice(-100),
    visitIndex: Math.min(state.visitIndex + 1, 99),
  };
}

export function removeAgentTab(
  state: AgentWorkspaceState,
  id: string,
  visibleScope: AgentScope,
): AgentWorkspaceState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (state.activeId !== id) return { ...state, tabs };

  const candidates: AgentTabState[] = [];
  for (
    let candidateIndex = Math.min(index - 1, tabs.length - 1);
    candidateIndex >= 0;
    candidateIndex -= 1
  ) {
    const candidate = tabs[candidateIndex];
    if (candidate) candidates.push(candidate);
  }
  for (let candidateIndex = Math.max(0, index); candidateIndex < tabs.length; candidateIndex += 1) {
    const candidate = tabs[candidateIndex];
    if (candidate) candidates.push(candidate);
  }
  const next = candidates.find((tab) => agentScopesEqual(tab.scope, visibleScope));
  return { ...state, activeId: next?.id ?? '', tabs };
}

export function disposeAgentWorkspace(state: AgentWorkspaceState): AgentWorkspaceState {
  return { ...state, disposed: true };
}

/** Back/forward visits stay inside the visible project and skip closed chats. */
export function agentVisitTarget(state: AgentWorkspaceState, direction: -1 | 1): number | null {
  const scope = state.tabs.find((tab) => tab.id === state.activeId)?.scope;
  if (!scope) return null;
  for (
    let index = state.visitIndex + direction;
    index >= 0 && index < state.visits.length;
    index += direction
  ) {
    if (
      state.tabs.some((tab) => tab.id === state.visits[index] && agentScopesEqual(tab.scope, scope))
    )
      return index;
  }
  return null;
}
