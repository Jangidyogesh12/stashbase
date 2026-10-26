import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { failureMessage } from '@/features/settings/application/failure-messages';
import { applyAppearanceSurface } from '@/shared/runtime/appearance-surface';
import { appearancePort, appearanceSurface } from '@/test/fakes/settings';
import { withQueryClient } from '@/test/query';

import { AppearancePanel } from './appearance-panel';

afterEach(() => {
  cleanup();
  applyAppearanceSurface(appearanceSurface());
  document.documentElement.classList.remove('light', 'dark');
});

const group = (name: string) => screen.getByRole('radiogroup', { name });

/** The group's options, in document order, named the way a reader hears them. */
function expectOptions(name: string, expected: readonly string[]) {
  const options = within(group(name)).getAllByRole('radio');
  expect(options.map((option) => option.getAttribute('value'))).toHaveLength(expected.length);
  expected.forEach((label, index) => {
    expect(options[index]).toBe(within(group(name)).getByRole('radio', { name: label }));
  });
}

/** The read has answered once a preset is checked. */
async function loaded() {
  await waitFor(() =>
    expect(within(group('Mode')).getByRole('radio', { name: 'Match system' })).toHaveProperty(
      'checked',
      true,
    ),
  );
}

describe('AppearancePanel', () => {
  it('offers each preset row with its presets in order', async () => {
    withQueryClient(<AppearancePanel appearanceApi={appearancePort()} />);
    await waitFor(() => expect(screen.getAllByRole('radiogroup')).toHaveLength(3));

    expectOptions('Mode', ['Match system', 'Light', 'Dark']);
    expectOptions('Interface size', ['Small', 'Default', 'Large']);
    expectOptions('Reduce motion', ['Match system', 'On']);
  });

  it('keeps the saved preset checked when the save is refused', async () => {
    const port = appearancePort({
      update: vi.fn(async () => {
        throw new Error('EPIPE');
      }),
    });
    withQueryClient(<AppearancePanel appearanceApi={port} />);
    await loaded();

    await userEvent.setup().click(within(group('Mode')).getByRole('radio', { name: 'Dark' }));

    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      failureMessage('unavailable'),
    );
    expect(within(group('Mode')).getByRole('radio', { name: 'Match system' })).toHaveProperty(
      'checked',
      true,
    );
  });
});
