import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { connectAgent } from '@/features/agent/application/connect-agent';
import { agentAccessFailure } from '@/features/agent/application/failure-messages';
import type { AgentCatalogPort } from '@/features/agent/application/ports';
import type { AgentWorkspaceRuntime } from '@/features/agent/application/workspace-runtime';
import { DEFAULT_AGENT_ID, type Agent } from '@/features/agent/domain/agent-catalog';
import { agentScopesEqual, type AgentId } from '@/features/agent/domain/session';
import { useRequestSignals } from '@/shared/runtime/use-request-signals';

/** A single explicit Send waits for access. Navigation or edits retire its consent. */
export function useAgentAccess({
  runtime,
  agents,
  catalog,
  onSignIn,
  onRefresh,
}: {
  runtime: AgentWorkspaceRuntime;
  agents: readonly Agent[];
  catalog: AgentCatalogPort;
  onSignIn(signal?: AbortSignal): void | Promise<boolean>;
  onRefresh(): void;
}) {
  const requestSignal = useRequestSignals<'access'>();
  const activeId = useStore(runtime.store, (state) => state.activeId);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** The Agent the open prompt is about. It outlives the prompt so the panel
   *  keeps its own words while it animates away. */
  const [agent, setAgent] = useState<AgentId>(DEFAULT_AGENT_ID);
  const pending = useRef<null | {
    session: ReturnType<AgentWorkspaceRuntime['activeSession']>;
    snapshot: ReturnType<ReturnType<AgentWorkspaceRuntime['activeSession']>['store']['getState']>;
    busy?: boolean;
    text: string;
    options?: { queuedId?: string };
    signal: AbortSignal;
  }>(null);
  const cancel = useCallback(() => {
    requestSignal('access');
    pending.current = null;
    setOpen(false);
    setWorking(false);
    setFailure(null);
  }, [requestSignal]);
  useEffect(() => {
    const check = () => {
      const workspace = runtime.store.getState();
      const request = pending.current;
      if (!request) return;
      const live = request.session.store.getState();
      if (
        workspace.activeId !== request.session.id ||
        live.agent !== request.snapshot.agent ||
        !agentScopesEqual(live.scope, request.snapshot.scope) ||
        live.draft !== request.snapshot.draft ||
        live.context !== request.snapshot.context ||
        live.skill !== request.snapshot.skill ||
        live.connection.kind === 'retired'
      )
        cancel();
    };
    const unsubscribe = runtime.store.subscribe(check);
    const unsubscribeSession = runtime.activeSession().store.subscribe(check);
    return () => {
      unsubscribe();
      unsubscribeSession();
      requestSignal('access');
      pending.current = null;
    };
  }, [runtime, activeId, requestSignal, cancel]);

  const send = (text: string, options?: { queuedId?: string }) => {
    if (pending.current) return;
    const session = runtime.activeSession();
    const snapshot = session.store.getState();
    if (agents.some((entry) => entry.id === snapshot.agent && entry.ready)) {
      void session.sendPrompt(text, options);
      return;
    }
    pending.current = {
      session,
      snapshot,
      text,
      ...(options ? { options } : {}),
      signal: requestSignal('access'),
    };
    setAgent(snapshot.agent);
    setFailure(null);
    setOpen(true);
  };

  /** Answer the prompt for the Agent it asked about: the account for the
   *  bundled runtime, installation and provider sign-in for a native one. */
  const confirm = async () => {
    const request = pending.current;
    if (!request || request.busy) return;
    request.busy = true;
    const chosen = request.snapshot.agent;
    setWorking(true);
    setFailure(null);
    const signal = AbortSignal.any([request.signal, request.session.signal]);
    try {
      // Persist the explicit choice, keeping cancellation active across the write.
      const selected = await runtime.chooseAgent(chosen);
      if (signal.aborted || !selected || runtime.activeSession() !== request.session) {
        if (!signal.aborted) {
          setFailure('Your agent choice could not be applied. Your message was kept.');
          setWorking(false);
        }
        cancel();
        return;
      }
      request.snapshot = request.session.store.getState();
      let ready = agents.find((entry) => entry.id === chosen)?.ready === true;
      if (!ready && chosen === DEFAULT_AGENT_ID) {
        if (!(await onSignIn(signal)))
          throw new Error('Sign-in was not completed. Your message was kept.');
      } else if (!ready) {
        const entry = agents.find((candidate) => candidate.id === chosen);
        await connectAgent(catalog, chosen, entry, signal);
        ready = true;
      }
      signal.throwIfAborted();
      if (!ready) {
        const refreshed = await catalog.listAgents(signal);
        ready = refreshed.agents.some((candidate) => candidate.id === chosen && candidate.ready);
      }
      signal.throwIfAborted();
      onRefresh();
      if (!ready)
        throw new Error('This agent is not connected yet. Try again or choose another agent.');
      if (pending.current !== request) return;
      pending.current = null;
      setOpen(false);
      setWorking(false);
      await request.session.sendPrompt(request.text, request.options);
    } catch (error) {
      if (signal.aborted) return;
      request.busy = false;
      setWorking(false);
      setFailure(agentAccessFailure(error));
    }
  };
  return { agent, open, working, failure, send, confirm, cancel };
}
