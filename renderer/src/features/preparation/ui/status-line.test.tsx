import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { PreparationStatusLine } from './status-line';

afterEach(cleanup);

describe('preparation status line', () => {
  it('stays silent for a current source', () => {
    const { container } = render(
      <PreparationStatusLine format="pdf" readiness={{ kind: 'current' }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('reports progress quietly with a cancel action while pending', async () => {
    const onCancel = vi.fn();
    render(
      <PreparationStatusLine
        format="pdf"
        onCancel={onCancel}
        onReprocess={vi.fn()}
        readiness={{ kind: 'pending', progress: { currentPage: 7, phase: 'extracting' } }}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Reading page 7…');
    expect(screen.queryByRole('button', { name: 'Reprocess' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('raises failures as alerts with reprocess, the busy label, and the action error', () => {
    const { rerender } = render(
      <PreparationStatusLine
        format="docx"
        onReprocess={vi.fn()}
        readiness={{ attempts: 2, detail: 'ocr crashed', kind: 'failed' }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('The document is visible');
    expect(screen.getByRole('button', { name: 'Reprocess' }).hasAttribute('disabled')).toBe(false);

    rerender(
      <PreparationStatusLine
        error="Reprocess could not start. Try again."
        format="docx"
        onReprocess={vi.fn()}
        pending="reprocess"
        readiness={{ attempts: 2, detail: 'ocr crashed', kind: 'failed' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reprocessing…' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('alert').textContent).toContain('Reprocess could not start.');
  });
});
