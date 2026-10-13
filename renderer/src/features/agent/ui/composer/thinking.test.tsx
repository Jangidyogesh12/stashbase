import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { AgentModel } from '@/features/agent/domain/runtime-catalog';
import { agentToolsApi, BUILT_IN_AGENT, CLAUDE_AGENT, CODEX_AGENT } from '@/test/fakes/agent';

import { AgentThinkingControl } from './thinking';

type ControlProps = ComponentProps<typeof AgentThinkingControl>;
type ControlState = ControlProps['state'];

/** The newest entry the way Codex lists it: flagged as the runtime's own
 *  default, with the level it runs at when none is chosen. */
const GPT: AgentModel = {
  defaultEffort: 'medium',
  id: 'gpt-codex',
  isDefault: true,
  label: 'Codex Max',
  supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'],
};
const MINI: AgentModel = { id: 'gpt-mini', label: 'Codex Mini' };
/** A Claude-shaped entry: levels, but no word on which one is the default. */
const OPUS: AgentModel = { id: 'opus', label: 'Opus', supportedEfforts: ['low', 'high'] };

function sessionState(overrides: Partial<ControlState> = {}): ControlState {
  return {
    activeModel: null,
    activeTurn: false,
    effort: null,
    model: null,
    models: [],
    transcript: [],
    ...overrides,
  };
}

function renderControl(overrides: Partial<ControlProps> = {}) {
  const spies = {
    onEffortChange: vi.fn<ControlProps['onEffortChange']>(),
    onModelChange: vi.fn<ControlProps['onModelChange']>(),
    onRequestCatalog: vi.fn<ControlProps['onRequestCatalog']>(),
  };
  render(
    <AgentThinkingControl
      {...spies}
      activeAgent={overrides.activeAgent ?? CODEX_AGENT}
      state={overrides.state ?? sessionState()}
      tools={{ chat: 'test-chat', api: agentToolsApi(), onChanged: vi.fn() }}
    />,
  );
  return { ...spies, user: userEvent.setup() };
}

/** The accessible names of the options an open layer marks as selected. */
function checkedNames(): string[] {
  return screen
    .getAllByRole('menuitemradio', { checked: true })
    .map((option) => option.getAttribute('aria-label') ?? option.textContent ?? '');
}

/** The accessible names of every option the open layer offers, in order. */
function optionNames(): string[] {
  return screen
    .getAllByRole('menuitemradio')
    .map((option) => option.getAttribute('aria-label') ?? option.textContent ?? '');
}

afterEach(cleanup);

describe('agent composer model-and-thinking control', () => {
  it('renders nothing for a runtime that advertises no model or level choice', () => {
    renderControl({ activeAgent: { ...BUILT_IN_AGENT, id: 'codex' } });

    expect(screen.queryByRole('button', { name: /^Model and thinking:/u })).toBeNull();
  });

  it('names the runtime default and its level before anything is chosen, and opens on the level', async () => {
    const { onEffortChange, onRequestCatalog, user } = renderControl({
      state: sessionState({ models: [GPT, MINI] }),
    });

    const trigger = screen.getByRole('button', { name: 'Model and thinking: Codex Max, Medium' });
    await user.click(trigger);
    expect(onRequestCatalog).toHaveBeenCalledTimes(1);

    // The declared default is one of the levels, so no separate Default row.
    expect(optionNames()).toEqual([
      'Low. Faster',
      'Medium. Balanced',
      'High. Deeper reasoning',
      'Extra high. Deepest reasoning',
      'Max. Maximum reasoning',
      'Auto',
    ]);
    expect(checkedNames()).toEqual(['Medium. Balanced']);
    expect(screen.getByRole('menuitem', { name: 'Model. Codex Max' })).not.toBeNull();

    await user.click(screen.getByRole('menuitemradio', { name: 'Extra high. Deepest reasoning' }));
    expect(onEffortChange).toHaveBeenCalledWith('xhigh');
    // A level pick keeps the menu open, as every choice menu here does.
    expect(screen.getByRole('menu')).not.toBeNull();
  });

  it('keeps the model one layer deeper, marks the one that will run, and offers the way back', async () => {
    const { onModelChange, user } = renderControl({
      state: sessionState({ models: [GPT, MINI] }),
    });

    await user.click(screen.getByRole('button', { name: 'Model and thinking: Codex Max, Medium' }));
    await user.click(screen.getByRole('menuitem', { name: 'Model. Codex Max' }));

    // The runtime named its default, so the list needs no Default row.
    expect(optionNames()).toEqual(['Codex Max', 'Codex Mini']);
    expect(checkedNames()).toEqual(['Codex Max']);

    await user.click(screen.getByRole('menuitem', { name: 'Back' }));
    expect(checkedNames()).toEqual(['Medium. Balanced']);

    await user.click(screen.getByRole('menuitem', { name: 'Model. Codex Max' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Codex Mini' }));
    expect(onModelChange).toHaveBeenCalledWith('gpt-mini');
  });

  it('closes on a model pick and opens on the level again', async () => {
    const { user } = renderControl({ state: sessionState({ models: [GPT, MINI] }) });
    const trigger = screen.getByRole('button', { name: 'Model and thinking: Codex Max, Medium' });

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Model. Codex Max' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Codex Mini' }));
    // The pick closes the menu, which leaves once its exit has played.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull(), { timeout: 2000 });

    await user.click(trigger);
    expect(await screen.findByRole('menuitemradio', { name: 'Medium. Balanced' })).not.toBeNull();
  });

  it('reads the explicit picks back and says when a model has no level to choose', async () => {
    renderControl({
      state: sessionState({ effort: 'high', model: 'gpt-codex', models: [GPT, MINI] }),
    });
    expect(
      screen.getByRole('button', { name: 'Model and thinking: Codex Max, High' }),
    ).not.toBeNull();
    cleanup();

    const { user } = renderControl({
      state: sessionState({ model: 'gpt-mini', models: [GPT, MINI] }),
    });
    await user.click(screen.getByRole('button', { name: 'Model and thinking: Codex Mini' }));
    expect(screen.getByText('Thinking is set by the runtime')).not.toBeNull();
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
    expect(screen.getByRole('menuitem', { name: 'Model. Codex Mini' })).not.toBeNull();
  });

  /** A runtime's model labels are aliases: "Opus" is whichever Opus that
   *  build runs, so the label alone cannot tell a reader which release they
   *  are on. The runtime says that in its description, and the row shows it. */
  it('shows the release a model alias resolves to, where the runtime names one', async () => {
    const { user } = renderControl({
      activeAgent: CLAUDE_AGENT,
      state: sessionState({
        models: [{ ...OPUS, description: 'Opus 5.5 with 1M context · Best for everyday tasks' }],
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Model and thinking: Default' }));
    await user.click(screen.getByRole('menuitem', { name: 'Model. Default' }));

    expect(
      screen.getByRole('menuitemradio', {
        name: 'Opus. Opus 5.5 with 1M context · Best for everyday tasks',
      }),
    ).not.toBeNull();
  });

  it('keeps a Default row wherever the runtime has named no default of its own', async () => {
    const first = renderControl({
      activeAgent: CLAUDE_AGENT,
      state: sessionState({ models: [OPUS] }),
    });

    await first.user.click(screen.getByRole('button', { name: 'Model and thinking: Default' }));
    expect(screen.getByText('Thinking is set by the runtime')).not.toBeNull();
    await first.user.click(screen.getByRole('menuitem', { name: 'Model. Default' }));
    expect(optionNames()).toEqual(['Default', 'Opus']);
    expect(checkedNames()).toEqual(['Default']);
    await first.user.click(screen.getByRole('menuitemradio', { name: 'Opus' }));
    expect(first.onModelChange).toHaveBeenCalledWith('opus');
    cleanup();

    const second = renderControl({
      activeAgent: CLAUDE_AGENT,
      state: sessionState({ effort: 'high', model: 'opus', models: [OPUS] }),
    });
    await second.user.click(screen.getByRole('button', { name: 'Model and thinking: Opus, High' }));
    expect(optionNames()).toEqual(['Default', 'Low. Faster', 'High. Deeper reasoning']);
    expect(checkedNames()).toEqual(['High. Deeper reasoning']);
    await second.user.click(screen.getByRole('menuitemradio', { name: 'Default' }));
    expect(second.onEffortChange).toHaveBeenCalledWith(null);
  });

  it('falls back to the model the runtime is actually running when none is chosen', () => {
    renderControl({ state: sessionState({ activeModel: 'gpt-mini', models: [GPT, MINI] }) });

    expect(screen.getByRole('button', { name: 'Model and thinking: Codex Mini' })).not.toBeNull();
  });

  it('binds model and level for the run of a streaming turn', () => {
    renderControl({ state: sessionState({ activeTurn: true, models: [GPT] }) });

    expect(
      screen
        .getByRole('button', { name: 'Model and thinking: Codex Max, Medium' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('locks the model once a Claude conversation has started, and leaves the level open', async () => {
    const { user } = renderControl({
      activeAgent: CLAUDE_AGENT,
      state: sessionState({
        model: 'opus',
        models: [OPUS],
        transcript: [{ id: 'u1', kind: 'user', text: 'Summarize the plan' }],
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Model and thinking: Opus' }));
    expect(
      screen.getByRole('menuitem', { name: 'Model. Opus' }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      screen
        .getByRole('menuitemradio', { name: 'High. Deeper reasoning' })
        .getAttribute('aria-disabled'),
    ).not.toBe('true');
  });

  it('opens straight on the model list for a runtime with no level to choose', async () => {
    const { user } = renderControl({
      activeAgent: { ...CODEX_AGENT, abilities: { ...CODEX_AGENT.abilities, effort: false } },
      state: sessionState({ models: [GPT, MINI] }),
    });

    await user.click(screen.getByRole('button', { name: 'Model and thinking: Codex Max, Medium' }));
    expect(optionNames()).toEqual(['Codex Max', 'Codex Mini']);
    expect(screen.queryByRole('menuitem', { name: 'Back' })).toBeNull();
  });
});
