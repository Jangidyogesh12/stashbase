/** The composer's `/` panel: the advertised skills it lists, the one it arms
 *  and spends on a single turn, the plain text it leaves for a runtime that
 *  runs none, and the retry it offers when the read failed. */
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { AgentContextPort, AgentSessionPort } from '@/features/agent/application/ports';
import {
  createAgentWorkspaceRuntime,
  type AgentWorkspaceRuntime,
} from '@/features/agent/application/workspace-runtime';
import type { Agent } from '@/features/agent/domain/agent-catalog';
import { draftOf, pressKey, typeInto } from '@/test/dom';
import {
  agentGateLifted,
  agentCatalogPort,
  agentContextPort,
  agentSessionPort,
  BUILT_IN_AGENT,
  CLAUDE_AGENT,
  CODEX_AGENT,
  agentPersonaApi,
} from '@/test/fakes/agent';
import { createTestQueryClient, withQueryClient } from '@/test/query';

import AgentChats from './chats/chats';
import ManagedAgentWorkspace from './workspace';

const RESEARCH_SCOPE = { kind: 'folder', path: '/Library/Research' } as const;

const runtimes: AgentWorkspaceRuntime[] = [];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

function renderWorkspace(
  session: AgentSessionPort,
  agents: readonly Agent[] = [BUILT_IN_AGENT, CODEX_AGENT, CLAUDE_AGENT],
  context?: AgentContextPort,
  onReprocess?: (source: { folderPath: string; path: string }) => void,
) {
  let id = 0;
  const runtime = createAgentWorkspaceRuntime({
    autostart: false,
    context,
    createId: () => `chat-${++id}`,
    folderPath: RESEARCH_SCOPE.path,
    port: session,
  });
  runtimes.push(runtime);
  const catalog = agentCatalogPort(agents);
  const view = withQueryClient(
    <div>
      <AgentChats
        catalog={catalog}
        onOpenAgentSettings={vi.fn()}
        runtime={runtime}
        scope={RESEARCH_SCOPE}
        workspaceName="Research"
      />
      <ManagedAgentWorkspace
        catalog={catalog}
        persona={agentPersonaApi()}
        onOpenAgentSettings={vi.fn()}
        onOpenExternal={vi.fn()}
        onSignIn={vi.fn()}
        onReprocess={onReprocess}
        runtime={runtime}
      />
    </div>,
    createTestQueryClient(),
    { strict: true },
  );
  return { runtime, view };
}
describe('AgentWorkspace composer skills', () => {
  async function skillWorkspace() {
    const test = agentSessionPort();
    const { runtime } = renderWorkspace(test.port, undefined, agentContextPort());
    await screen.findByText('What’s on your mind?');
    await agentGateLifted();
    await userEvent.click(screen.getByRole('button', { name: 'Provider: Default' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Codex' }));
    act(() => runtime.activeSession().start());
    return { ...test, runtime };
  }

  it('lists advertised skills for /, arms the picked one, and sends it alone', async () => {
    const test = await skillWorkspace();
    act(() => {
      test.listeners[0]?.onEvent({
        error: null,
        kind: 'skills',
        skills: [
          { id: 'review', label: 'review', description: 'Review the draft' },
          { id: 'summarize', label: 'summarize', description: 'Summarize a folder' },
        ],
        state: 'available',
      });
      test.listeners[0]?.onEvent({ kind: 'ready' });
    });

    const composer = screen.getByRole('textbox', { name: 'Message' });
    typeInto(composer, '/rev');
    expect(await screen.findByRole('listbox', { name: 'Run a skill' })).not.toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(1);

    pressKey(composer, 'Enter');
    expect(test.runtime.activeSession().store.getState().skill).toBe('review');
    expect(composer.querySelector('[data-skill="review"]')?.textContent).toContain('/review'); // dom-contract: CodeMirror WidgetType in the editor's text layer
    expect(draftOf(test.runtime)).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(test.sent).toContainEqual({
        kind: 'prompt',
        telemetryTurnId: expect.any(String),
        skill: 'review',
        text: '',
        titleHint: '/review',
      }),
    );
    expect(test.runtime.activeSession().store.getState().skill).toBe(null);
    expect((await screen.findAllByText('/review')).length).toBeGreaterThan(0);
  });

  it('leaves / as plain text for a runtime that runs no skills', async () => {
    const test = agentSessionPort();
    const { runtime } = renderWorkspace(test.port, undefined, agentContextPort());
    await screen.findByText('What’s on your mind?');
    await agentGateLifted();
    act(() => runtime.activeSession().start());

    const composer = screen.getByRole('textbox', { name: 'Message' });
    typeInto(composer, '/rev');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(draftOf(runtime)).toBe('/rev');
  });

  it('offers a retry when the runtime could not read its skills', async () => {
    const test = await skillWorkspace();
    act(() => {
      test.listeners[0]?.onEvent({
        error: 'Skill folder is unreadable.',
        kind: 'skills',
        skills: [],
        state: 'failed',
      });
      test.listeners[0]?.onEvent({ kind: 'ready' });
    });

    const composer = screen.getByRole('textbox', { name: 'Message' });
    typeInto(composer, '/');
    expect(await screen.findByText('Could not load skills.')).not.toBeNull();
    expect(screen.queryByRole('option')).toBeNull();

    // The panel is explaining itself, so Enter must not send the text behind it.
    pressKey(composer, 'Enter');
    expect(test.sent).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(test.sent).toContainEqual({ kind: 'refresh-skills' });
  });
});
