import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { agentSessionPort, agentToolsApi } from '@/test/fakes/agent';

import { registerWorkspaceCleanup, renderWorkspace } from './workspace.harness';

registerWorkspaceCleanup();

const option = (id: string, label: string, available: boolean) => ({
  id,
  label,
  available,
  reason: available ? null : 'Not available right now.',
});

describe('Crew in the workspace', () => {
  it("turns crew members on together and changes a member's model from the composer", async () => {
    const tools = agentToolsApi();
    renderWorkspace(agentSessionPort().port, undefined, undefined, undefined, {}, vi.fn(), tools);
    expect(screen.queryByRole('button', { name: /^Model and thinking/ })).toBeNull();

    // Every member starts off, each row naming the model it would run on.
    await userEvent.click(await screen.findByRole('button', { name: 'Crew: None' }));
    const writer = await screen.findByRole('menuitemcheckbox', {
      name: 'Writer. Claude Sonnet 5.5',
    });
    expect(writer.getAttribute('aria-checked')).toBe('false');

    // Rows turn members on in place, and several may be on at once.
    await userEvent.click(writer);
    await waitFor(() =>
      expect(tools.set).toHaveBeenCalledWith(
        'writer',
        { enabled: true },
        expect.anything(),
        expect.any(String),
      ),
    );
    await userEvent.click(
      screen.getByRole('menuitemcheckbox', { name: 'Reviewer. Claude Sonnet 5.5' }),
    );
    expect(await screen.findByRole('button', { name: 'Crew: Writer, Reviewer' })).not.toBeNull();

    // ArrowRight on a row opens its models, and a pick returns to the list
    // with the member still on.
    screen.getByRole('menuitemcheckbox', { name: 'Writer. Claude Sonnet 5.5' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Claude Opus 5.5' }));
    await waitFor(() =>
      expect(tools.set).toHaveBeenCalledWith(
        'writer',
        { model: 'claude-opus-5-5' },
        expect.anything(),
        expect.any(String),
      ),
    );
    const switched = await screen.findByRole('menuitemcheckbox', {
      name: 'Writer. Claude Opus 5.5',
    });
    expect(switched.getAttribute('aria-checked')).toBe('true');
  });

  it('shows a switched-off member and a member waiting for a model choice without picking one', async () => {
    const base = { summary: '', icon: 'unknown-icon', enabled: false, defaultModel: 'opus' };
    const tools = {
      list: vi.fn(async () => [
        {
          ...base,
          id: 'writer',
          toolName: 'write_draft',
          label: 'Writer',
          unavailable: 'Not available right now.',
          model: null,
          modelProblem: null,
          options: [],
        },
        {
          ...base,
          id: 'reader',
          toolName: 'read_draft',
          label: 'Reader',
          unavailable: null,
          model: null,
          modelProblem: 'Its default model is unavailable. Choose another model.',
          options: [option('opus', 'Opus', false), option('sol', 'Sol', true)],
        },
      ]),
      set: vi.fn(async () => []),
    };
    renderWorkspace(agentSessionPort().port, undefined, undefined, undefined, {}, vi.fn(), tools);
    await userEvent.click(await screen.findByRole('button', { name: 'Crew: None' }));
    const writer = await screen.findByRole('menuitemcheckbox', {
      name: 'Writer. Not available right now.',
    });
    expect(writer.getAttribute('aria-disabled')).toBe('true');

    screen
      .getByRole('menuitemcheckbox', { name: /^Reader\. Its default model is unavailable/ })
      .focus();
    await userEvent.keyboard('{ArrowRight}');
    const opus = await screen.findByRole('menuitemradio', { name: /^Opus/ });
    expect(opus.getAttribute('aria-disabled')).toBe('true');
    expect(tools.set).not.toHaveBeenCalled();
  });
});
