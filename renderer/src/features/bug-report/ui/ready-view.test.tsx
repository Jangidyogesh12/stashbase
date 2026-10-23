import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { failureMessage } from '@/features/bug-report/application/failure-messages';
import { createBugReportReviewRuntime } from '@/features/bug-report/application/review-runtime';
import { approvedReport, bugReportReviewPort } from '@/test/fakes/bug-report';

import { UNPREPARED_TEXT } from './labels';
import { BugReportReview } from './review-window';

afterEach(cleanup);

async function mountReady(...args: Parameters<typeof bugReportReviewPort>) {
  const port = bugReportReviewPort(...args);
  const closeWindow = vi.fn();
  const runtime = createBugReportReviewRuntime(port, { closeWindow });
  render(<BugReportReview runtime={runtime} />);
  await runtime.load();
  await runtime.prepare();
  await screen.findByRole('heading', { level: 1, name: 'Report ready' });
  return { closeWindow, port, runtime };
}

describe('bug report ready view', () => {
  it('offers both handoffs and reports where the files went', async () => {
    const { port } = await mountReady();
    const user = userEvent.setup();
    expect(screen.getByText(/prefilled GitHub issue/u)).not.toBeNull();
    expect(screen.getByText(/without opening GitHub/u)).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open GitHub' }));
    await waitFor(() => expect(port.calls).toContain('openGitHub'));
    expect(screen.getByRole('status').textContent).toBe(
      'Files are in your Downloads folder. Attach them to the GitHub issue.',
    );

    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(port.calls).toContain('saveArtifacts'));
    expect(screen.getByRole('status').textContent).toBe('Files are in your Downloads folder.');
  });

  it('reports a handoff main refused', async () => {
    await mountReady({ refuse: { openGitHub: 'github-open-failed' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open GitHub' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      failureMessage('github-open-failed'),
    );
  });

  it('goes back to a fresh review focused on the problem field', async () => {
    const { port } = await mountReady();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back' }));
    const problem = await screen.findByRole('textbox', { name: 'What went wrong?' });
    expect(document.activeElement).toBe(problem);
    expect(port.calls).toContain('reopen');
    expect(screen.getByRole('button', { name: 'Prepare report' })).not.toBeNull();
  });

  it('closes without discarding once the report is approved', async () => {
    const { closeWindow, port } = await mountReady();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(closeWindow).toHaveBeenCalledOnce());
    expect(port.calls).not.toContain('discard');
  });

  it('holds the handoffs behind Retry until the files are prepared', async () => {
    const report = approvedReport();
    let attempts = 0;
    await mountReady(
      {},
      {
        prepare: async () => {
          attempts += 1;
          return attempts === 1
            ? { failure: { kind: 'downloads-failed' }, kind: 'approved-unprepared', report }
            : { artifactCount: 1, kind: 'prepared', report };
        },
      },
    );
    expect(screen.getByText(failureMessage('downloads-failed'))).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Open GitHub' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Download' }).hasAttribute('disabled')).toBe(true);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Open GitHub' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('explains an approval it did not see prepared', async () => {
    const port = bugReportReviewPort({ snapshot: { kind: 'approved', report: approvedReport() } });
    const runtime = createBugReportReviewRuntime(port, { closeWindow: vi.fn() });
    render(<BugReportReview runtime={runtime} />);
    await screen.findByRole('heading', { level: 1, name: 'Report ready' });
    expect(screen.getByText(UNPREPARED_TEXT)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull();
  });
});
