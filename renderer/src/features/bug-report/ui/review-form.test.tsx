import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { failureMessage } from '@/features/bug-report/application/failure-messages';
import { createBugReportReviewRuntime } from '@/features/bug-report/application/review-runtime';
import { bugReportReviewPort, reviewDraft } from '@/test/fakes/bug-report';

import { BugReportReview } from './review-window';

afterEach(cleanup);

const noop = () => undefined;

function mount(...args: Parameters<typeof bugReportReviewPort>) {
  const port = bugReportReviewPort(...args);
  const closeWindow = vi.fn();
  const runtime = createBugReportReviewRuntime(port, { closeWindow });
  render(<BugReportReview runtime={runtime} />);
  return { closeWindow, port, runtime };
}

const problemField = () => screen.findByRole('textbox', { name: 'What went wrong?' });

describe('bug report review form', () => {
  it('opens on the problem field with the lede and every attachment', async () => {
    mount();
    const problem = await problemField();
    expect(document.activeElement).toBe(problem);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Report a bug');
    expect(screen.getByText(/Nothing is sent automatically/u)).not.toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Prepare report' })).not.toBeNull();
  });

  it('commits a description on blur and reports it', async () => {
    const { port } = mount();
    const user = userEvent.setup();
    const problem = await problemField();
    expect(problem.getAttribute('maxlength')).toBe('12000');
    await user.type(problem, 'Save failed');
    await user.tab();
    await waitFor(() => expect(port.calls).toContain('updateDescription'));
    expect(port.draft.description.problem).toBe('Save failed');
    expect(screen.getByRole('status').textContent).toBe('Report details updated.');
  });

  it('discloses the reproduction steps on request, and by itself when they have text', async () => {
    mount();
    const user = userEvent.setup();
    await problemField();
    const disclose = screen.getByRole('button', { name: /steps to reproduce/iu });
    expect(disclose.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Steps to reproduce' })).toBeNull();
    await user.click(disclose);
    expect(disclose.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Steps to reproduce' })).not.toBeNull();

    cleanup();
    mount({
      snapshot: {
        draft: reviewDraft({ description: { problem: 'x', reproduction: '1. Save' } }),
        kind: 'reviewing',
      },
    });
    await problemField();
    expect(
      screen.getByRole('button', { name: /steps to reproduce/iu }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Steps to reproduce' })).toHaveProperty(
      'value',
      '1. Save',
    );
  });

  it('routes an include through main and says so', async () => {
    const { port } = mount();
    await problemField();
    await userEvent
      .setup()
      .click(screen.getByRole('switch', { name: 'Include Application log in the report' }));
    await waitFor(() => expect(port.calls).toContain('includeArtifact'));
    expect(screen.getByRole('status').textContent).toBe('Application log included.');
    expect(
      screen
        .getByRole('switch', { name: 'Include Application log in the report' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shows a failed preview beside a form that still works', async () => {
    const { port } = mount({ previews: {} });
    await problemField();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Preview for Application log' }));
    expect(await screen.findByText(failureMessage('artifact-unavailable'))).not.toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Include Application log in the report' }));
    await waitFor(() => expect(port.calls).toContain('includeArtifact'));
    expect(screen.queryByRole('alert')?.textContent).toBe('');
  });

  it('locks the form while preparing, then moves focus to the ready heading', async () => {
    let finishPrepare: () => void = noop;
    mount(
      {},
      {
        prepare: () =>
          new Promise((resolve) => {
            finishPrepare = () =>
              resolve({
                artifactCount: 1,
                kind: 'prepared',
                report: {
                  approvedAt: '2026-03-04T10:00:00.000Z',
                  artifacts: [],
                  description: { problem: '', reproduction: '' },
                },
              });
          }),
      },
    );
    await problemField();
    // The button keeps its name while it works; the status line says what for.
    const prepare = screen.getByRole('button', { name: 'Prepare report' });
    await userEvent.setup().click(prepare);
    await waitFor(() => expect(prepare.hasAttribute('disabled')).toBe(true));
    expect(screen.getByRole('textbox', { name: 'What went wrong?' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('status').textContent).toBe('Checking and preparing the report…');
    finishPrepare();
    const heading = await screen.findByRole('heading', { level: 1, name: 'Report ready' });
    expect(document.activeElement).toBe(heading);
  });

  it('reports a refused preparation and keeps the form', async () => {
    mount({ refuse: { prepare: 'privacy' } });
    await problemField();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Prepare report' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      failureMessage('privacy'),
    );
    expect(screen.getByRole('button', { name: 'Prepare report' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('discards the draft on cancel and closes the window', async () => {
    const { closeWindow, port } = mount();
    await problemField();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(closeWindow).toHaveBeenCalledOnce());
    expect(port.calls).toContain('discard');
  });

  it('shows a report that is gone as unavailable with a way out', async () => {
    const { closeWindow, port } = mount({ refuse: { get: 'draft-gone' } });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      failureMessage('draft-gone'),
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(closeWindow).toHaveBeenCalledOnce());
    expect(port.calls).not.toContain('discard');
  });
});

it('keeps edits made during blur-save and locks the final approval save', async () => {
  const { port } = mount();
  const updates = port.updateDescription;
  const replies: (() => void)[] = [];
  port.updateDescription = async (description) => {
    const draft = await updates(description);
    await new Promise<void>((resolve) => {
      replies.push(resolve);
    });
    return draft;
  };
  const user = userEvent.setup();
  const problem = await problemField();
  await user.type(problem, 'Original');
  await user.click(screen.getByRole('button', { name: 'Prepare report' }));
  await waitFor(() => expect(replies).toHaveLength(1));
  // The blur save preceded Prepare on the command queue; further edits must
  // survive that old response and join the final save before approval.
  await user.type(problem, ' corrected');
  const first = replies[0];
  if (!first) throw new Error('blur save did not start');
  await act(async () => first());
  await waitFor(() => expect(replies).toHaveLength(2));
  expect(problem).toHaveProperty('disabled', true);
  expect(problem).toHaveProperty('value', 'Original corrected');
  expect(port.calls).not.toContain('prepare');
  const second = replies[1];
  if (!second) throw new Error('approval save did not start');
  await act(async () => second());
  expect(await screen.findByRole('heading', { name: 'Report ready' })).not.toBeNull();
  expect(port.draft.description.problem).toBe('Original corrected');
});
