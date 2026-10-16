/** The strip row: which sentence it says, and what each control it carries
 *  reaches. */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type {
  UpdateNoticeOffer,
  UpdateNoticeViewModel,
} from '@/features/updates/hooks/use-update-notice';
import type { FailureView } from '@/shared/domain/feature-error';

import { UpdateNotice } from './update-notice';

afterEach(cleanup);

const READY: UpdateNoticeOffer = {
  actionLabel: 'Restart to update',
  message: 'StashBase 1.5.0 is ready to install.',
};

const UNREACHABLE: FailureView = {
  message: 'StashBase could not reach the updater.',
  tone: 'capability',
};

function mount(parts: Pick<UpdateNoticeViewModel, 'failure' | 'offer'>): UpdateNoticeViewModel {
  const notice: UpdateNoticeViewModel = {
    act: vi.fn(),
    dismiss: vi.fn(),
    ...parts,
  };
  render(<UpdateNotice notice={notice} />);
  return notice;
}

const controls = () =>
  screen
    .queryAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);

describe('UpdateNotice', () => {
  it('says nothing when the window has neither an offer nor a refusal', () => {
    mount({ failure: null, offer: null });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(controls()).toEqual([]);
  });

  it('reads an offer as a status and routes each control it carries', async () => {
    const notice = mount({ failure: null, offer: READY });

    expect(screen.getByRole('status').textContent).toContain(READY.message);
    expect(controls()).toEqual(['Dismiss update notification', 'Restart to update']);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Restart to update' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss update notification' }));

    expect(notice.act).toHaveBeenCalledOnce();
    expect(notice.dismiss).toHaveBeenCalledOnce();
  });

  it('leaves only the dismissal for a phase that invites nothing', () => {
    mount({
      failure: null,
      offer: {
        actionLabel: null,
        message: 'Installing the update. StashBase will restart.',
      },
    });
    expect(screen.getByRole('status').textContent).toContain(
      'Installing the update. StashBase will restart.',
    );
    expect(controls()).toEqual(['Dismiss update notification']);
  });

  it('says an unreachable updater quietly, in place of the offer sentence', () => {
    mount({ failure: UNREACHABLE, offer: READY });

    const row = screen.getByRole('status');
    expect(row.textContent).toContain(UNREACHABLE.message);
    expect(row.textContent).not.toContain(READY.message);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(controls()).toEqual(['Dismiss update notification', 'Restart to update']);
  });

  it('allows dismissal of a refusal without offering an update action', () => {
    mount({ failure: UNREACHABLE, offer: null });
    expect(screen.getByRole('status').textContent).toBe(UNREACHABLE.message);
    expect(controls()).toEqual(['Dismiss update notification']);
  });

  it('interrupts only for a refusal the reader could act on', () => {
    mount({ failure: { message: 'That folder is not writable.', tone: 'input' }, offer: null });
    expect(screen.getByRole('alert').textContent).toBe('That folder is not writable.');
  });
});
