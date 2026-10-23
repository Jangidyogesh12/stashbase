import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import type { AgentRuntimeUpdateView } from '@/features/agent/hooks/use-agent-runtime-update';

import { AgentUpgradeOfferCard } from './upgrade-offer';

afterEach(cleanup);

const OFFER = { model: 'Opus 5.5', note: 'Update to 2.1.280+ to use Opus 5.5' } as const;

function view(overrides: Partial<AgentRuntimeUpdateView> = {}): AgentRuntimeUpdateView {
  return {
    busy: false,
    completed: false,
    completedBlockId: null,
    failure: null,
    label: 'Claude',
    progress: null,
    update: vi.fn(),
    ...overrides,
  };
}

it('names the model and runs the update with nothing to resend', async () => {
  const update = vi.fn();
  render(<AgentUpgradeOfferCard offer={OFFER} runtimeUpdate={view({ update })} />);

  expect(screen.getByText('Update to 2.1.280+ to use Opus 5.5')).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Update Claude' }));

  // The offer has no refused request behind it, so the update must not ask
  // the session to send one again.
  expect(update).toHaveBeenCalledWith();
});

it('stops offering once the reader dismisses it', async () => {
  render(<AgentUpgradeOfferCard offer={OFFER} runtimeUpdate={view()} />);

  await userEvent.setup().click(screen.getByRole('button', { name: 'Not now' }));

  expect(screen.queryByRole('button', { name: 'Update Claude' })).toBeNull();
});

it('stops offering once the update has run', () => {
  render(<AgentUpgradeOfferCard offer={OFFER} runtimeUpdate={view({ completed: true })} />);

  expect(screen.queryByRole('button', { name: 'Update Claude' })).toBeNull();
});

it('reports a failed update where the offer stood', () => {
  render(
    <AgentUpgradeOfferCard
      offer={OFFER}
      runtimeUpdate={view({ failure: 'Claude could not be updated.' })}
    />,
  );

  expect(screen.getByRole('alert').textContent).toBe('Claude could not be updated.');
});
