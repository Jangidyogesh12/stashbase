import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { UpdatePreview } from './update-preview';

afterEach(cleanup);

it('requests a sidebar preview only when asked, defaulting to ready to install', async () => {
  const user = userEvent.setup();
  const show = vi.fn();
  const stop = vi.fn();
  render(<UpdatePreview active onShow={show} onStop={stop} />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(show).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Preview in sidebar' }));
  expect(show).toHaveBeenLastCalledWith({ phase: 'ready', version: '9.9.9' });
  await user.click(screen.getByRole('combobox', { name: 'Update state' }));
  await user.click(screen.getByRole('option', { name: 'Installing' }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  expect(show).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Preview in sidebar' }));
  expect(show).toHaveBeenLastCalledWith({ phase: 'installing', version: '9.9.9' });
  await user.click(screen.getByRole('button', { name: 'Stop preview' }));
  expect(stop).toHaveBeenCalledOnce();
});
