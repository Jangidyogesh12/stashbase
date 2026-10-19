import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { createDocumentTabsRuntime } from '@/features/documents/public';
import { documentTabsRuntimeOptions } from '@/test/fakes/documents';

import { AgentDocumentWorkspace } from './agent-document-workspace';

afterEach(cleanup);

/** The row reads only whether any document is open, so the test opens and
 *  closes one real document rather than reaching into the runtime's store. */
const PLAN = { folderPath: '/project/notes', path: 'plan.md' } as const;

describe('Agent document workspace row', () => {
  it('keeps one Agent workspace mounted while documents open and close', async () => {
    const mounts = vi.fn();
    function AgentProbe() {
      useEffect(() => {
        mounts();
      }, []);
      return <div data-testid="agent" />;
    }
    const runtime = createDocumentTabsRuntime(documentTabsRuntimeOptions());
    render(
      <AgentDocumentWorkspace
        agent={<AgentProbe />}
        document={<div data-testid="document">Plan</div>}
        onPaneWidthChange={vi.fn()}
        paneWidth={576}
        runtime={runtime}
      />,
    );

    expect(mounts).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('document-slot').getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('separator', { name: 'Resize agent pane' })).toBeNull();

    await act(async () => void (await runtime.open(PLAN)));
    expect(mounts).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('document-slot').getAttribute('aria-hidden')).toBe('false');
    expect(screen.getByRole('separator', { name: 'Resize agent pane' })).not.toBeNull();
    expect(screen.getByTestId('agent')).not.toBeNull();

    await act(async () => void (await runtime.closeSource(PLAN)));
    expect(mounts).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('document-slot').getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('separator', { name: 'Resize agent pane' })).toBeNull();
    runtime.dispose();
  });

  it('keeps a hidden Agent mounted but inert and gives the document the row', async () => {
    const runtime = createDocumentTabsRuntime(documentTabsRuntimeOptions());
    render(
      <AgentDocumentWorkspace
        agent={<div data-testid="agent" />}
        chatPaneOpen={false}
        document={<div data-testid="document">Plan</div>}
        onPaneWidthChange={vi.fn()}
        paneWidth={576}
        runtime={runtime}
      />,
    );
    await act(async () => void (await runtime.open(PLAN)));

    // No seam to drag while the document has the whole row, and the Agent's
    // transcript is still in the tree for when the panel comes back.
    expect(screen.queryByRole('separator', { name: 'Resize agent pane' })).toBeNull();
    expect(screen.getByTestId('agent')).not.toBeNull();
    const shelf = screen.getByTestId('agent-pane').parentElement;
    expect(shelf?.getAttribute('aria-hidden')).toBe('true');
    expect(shelf?.hasAttribute('inert')).toBe(true);
    expect(screen.getByTestId('document-slot').getAttribute('aria-hidden')).toBe('false');
    runtime.dispose();
  });

  it('gives the Agent the whole row while documents are off screen, whatever the toggle says', async () => {
    const runtime = createDocumentTabsRuntime(documentTabsRuntimeOptions());
    render(
      <AgentDocumentWorkspace
        agent={<div data-testid="agent" />}
        chatPaneOpen={false}
        document={<div data-testid="document">Plan</div>}
        documentsShown={false}
        onPaneWidthChange={vi.fn()}
        paneWidth={576}
        runtime={runtime}
      />,
    );
    await act(async () => void (await runtime.open(PLAN)));

    // Chats mode: the open document stays mounted but leaves the row, and
    // the Agent takes it even though the Chat toggle last said hide.
    const slot = screen.getByTestId('document-slot');
    expect(slot.getAttribute('aria-hidden')).toBe('true');
    expect(slot.hasAttribute('inert')).toBe(true);
    expect(screen.getByTestId('document')).not.toBeNull();
    const shelf = screen.getByTestId('agent-pane').parentElement;
    expect(shelf?.getAttribute('aria-hidden')).toBe('false');
    expect(shelf?.hasAttribute('inert')).toBe(false);
    expect(screen.getByTestId('agent-pane').style.width).toBe('100%');
    expect(screen.queryByRole('separator', { name: 'Resize agent pane' })).toBeNull();
    runtime.dispose();
  });

  it('gives the Agent the whole row without a documents runtime', () => {
    render(
      <AgentDocumentWorkspace
        agent={<div data-testid="agent" />}
        document={null}
        onPaneWidthChange={vi.fn()}
        paneWidth={576}
        runtime={null}
      />,
    );
    expect(screen.getByTestId('agent')).not.toBeNull();
    // The box is the row: no pixel width of its own.
    expect(screen.getByTestId('agent-pane').style.width).toBe('100%');
  });
});
