import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { AgentRuntime } from '@/features/settings/domain/agent-catalog';
import type { FailureView } from '@/shared/domain/feature-error';
import { agentRuntime } from '@/test/fakes/settings';

import { RuntimeRow } from './runtime-row';

afterEach(cleanup);

function codex(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return agentRuntime({
    id: 'codex',
    installed: false,
    label: 'Codex',
    ownership: null,
    preparation: { kind: 'idle' },
    ...overrides,
  });
}

function renderRow(
  subject: AgentRuntime,
  options: { busy?: boolean; failure?: FailureView | null } = {},
) {
  const onAction = vi.fn();
  const onOpenSignIn = vi.fn();
  const onStop = vi.fn();
  render(
    <RuntimeRow
      busy={options.busy ?? false}
      failure={options.failure ?? null}
      onAction={onAction}
      onOpenSignIn={onOpenSignIn}
      onStop={onStop}
      runtime={subject}
    />,
  );
  return { onAction, onOpenSignIn, onStop };
}

describe('RuntimeRow', () => {
  it('offers the single action its status derives, and hands it back on click', async () => {
    const subject = codex();
    const { onAction } = renderRow(subject);

    expect(screen.getByText('Not installed')).not.toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Install' }));

    expect(onAction).toHaveBeenCalledWith({ kind: 'install', label: 'Install' }, subject);
  });

  it('keeps the action name on its spinner while the runtime is busy', () => {
    renderRow(codex(), { busy: true });

    expect(screen.getByRole('button', { name: 'Install' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Preparing…' })).toBeNull();
  });

  it('says where preparation stands in one sentence, with no progress ornament', () => {
    renderRow(
      codex({
        installed: true,
        preparation: { kind: 'running', note: 'Connecting…', stage: 'configure' },
      }),
    );
    expect(screen.getByText('Connecting…')).not.toBeNull();
    expect(screen.queryByText('Connect')).toBeNull();

    cleanup();
    renderRow(codex({ installed: true, ownership: 'system', preparation: { kind: 'ready' } }));
    expect(screen.getByText('Ready')).not.toBeNull();
  });

  it('waits on the browser with the page again and a way to stop waiting', async () => {
    const url = 'https://auth.openai.com/oauth/authorize?state=1';
    const subject = codex({
      installed: true,
      preparation: {
        kind: 'running',
        note: 'Finish signing in to Codex in your browser.',
        signInUrl: url,
        stage: 'authenticate',
      },
    });
    const { onOpenSignIn, onStop } = renderRow(subject);
    const user = userEvent.setup();
    // The wait is said in the detail line; the button keeps its action's name.
    expect(screen.getByText('Finish signing in to Codex in your browser.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Open sign-in page' }));
    expect(onOpenSignIn).toHaveBeenCalledWith(url);
    await user.click(screen.getByRole('button', { name: 'Stop waiting' }));
    expect(onStop).toHaveBeenCalledWith(subject);
  });

  it('keeps a command failure on the row it belongs to', () => {
    renderRow(codex(), {
      failure: { message: 'Installer exited with status 1.', tone: 'input' },
    });

    expect(screen.getByRole('alert').textContent).toBe('Installer exited with status 1.');
  });
});
