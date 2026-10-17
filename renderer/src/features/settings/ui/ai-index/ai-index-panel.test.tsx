import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { EmbedderError, type EmbedderPort } from '@/features/settings/application/embedder-port';
import { failureMessage } from '@/features/settings/application/failure-messages';
import { embedderPort, embedderState, keyedEmbedderState } from '@/test/fakes/settings';
import { withQueryClient } from '@/test/query';

import { AiIndexPanel } from './ai-index-panel';

function renderPanel(port: EmbedderPort) {
  return withQueryClient(<AiIndexPanel embedderApi={port} />);
}

afterEach(cleanup);

describe('search by meaning settings panel', () => {
  it('opens on the key editor when nothing is set up, and never offers a sign-in', async () => {
    const port = embedderPort(embedderState());
    renderPanel(port);
    const user = userEvent.setup();

    expect(
      await screen.findByText('Search by meaning is off. Add a key to turn it on.'),
    ).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Sign in/u })).toBeNull();
    expect(screen.queryByText(/StashBase account/u)).toBeNull();
    // With no key there is nothing to cancel back to, so the editor is open
    // and has no Cancel.
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    await user.type(screen.getByPlaceholderText('Paste your API key'), 'sk-secret');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    await waitFor(() =>
      expect(port.saveKey).toHaveBeenCalledWith('openai', 'sk-secret', expect.any(AbortSignal)),
    );
  });

  it('marks a stored key active and offers to replace or remove it', async () => {
    renderPanel(embedderPort(keyedEmbedderState({ provider: 'openrouter' })));

    expect(await screen.findByText('OpenRouter key saved')).not.toBeNull();
    expect(screen.getByText('Active')).not.toBeNull();
    expect(screen.queryByText(/Search by meaning is off/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Replace key' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Remove key' })).not.toBeNull();
    expect(screen.queryByPlaceholderText('Paste your API key')).toBeNull();
  });

  it('reports a rejected key as the reader’s to fix', async () => {
    const port = embedderPort(embedderState(), {
      saveKey: vi.fn(async () => {
        throw new EmbedderError('rejected', 'HTTP 401 from the provider');
      }),
    });
    renderPanel(port);
    const user = userEvent.setup();

    await user.type(await screen.findByPlaceholderText('Paste your API key'), 'bad');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect((await screen.findByRole('alert')).textContent).toBe(failureMessage('rejected'));
  });

  it('reports an unreachable embedder quietly rather than as something to correct', async () => {
    const port = embedderPort(keyedEmbedderState(), {
      removeKey: vi.fn(async () => {
        throw new EmbedderError('unavailable', 'HTTP 503 from /api/embedder');
      }),
    });
    renderPanel(port);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Remove key' }));

    const notice = await screen.findByText(failureMessage('unavailable'));
    expect(notice.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
