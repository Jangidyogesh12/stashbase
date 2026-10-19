import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { lazySurface } from './lazy-surface';
import { SurfaceBoundary } from './surface-boundary';

afterEach(cleanup);

beforeEach(() => {
  // React reports a caught render error through `console.error`; the boundary
  // logs one of its own. Silencing both keeps the run readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Whether the fixture surface is still broken. A test clears it before
 *  retrying, standing in for a chunk that loads on the second attempt. */
let failing = true;

beforeEach(() => {
  failing = true;
});

function Surface({ message = 'boom' }: { message?: string }) {
  if (failing) throw new Error(message);
  return <p>Surface content</p>;
}

describe('SurfaceBoundary', () => {
  it('shows the recovery for a surface that threw and leaves its neighbours alone', () => {
    render(
      <>
        <p>Folder list</p>
        <SurfaceBoundary
          placement="pane"
          recovery={{ actions: [{ label: 'Retry' }], message: 'The agent view could not load.' }}
          surface="Agent"
        >
          <Surface />
        </SurfaceBoundary>
      </>,
    );

    expect(screen.getByText('The agent view could not load.').isConnected).toBe(true);
    expect(screen.getByRole('button', { name: 'Retry' }).isConnected).toBe(true);
    expect(screen.getByText('Folder list').isConnected).toBe(true);
  });

  it('remounts the surface when a recovery action carries no work of its own', () => {
    render(
      <SurfaceBoundary
        placement="pane"
        recovery={{ actions: [{ label: 'Retry' }], message: 'The agent view could not load.' }}
        surface="Agent"
      >
        <Surface />
      </SurfaceBoundary>,
    );

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('Surface content').isConnected).toBe(true);
    expect(screen.queryByText('The agent view could not load.')).toBeNull();
  });

  it('runs the pressed action and clears the failure', () => {
    const close = vi.fn();
    render(
      <SurfaceBoundary
        placement="overlay"
        recovery={{
          actions: [{ label: 'Retry' }, { label: 'Close', perform: close }],
          message: 'Quick Open could not load.',
        }}
        surface="Quick Open"
      >
        <Surface />
      </SurfaceBoundary>,
    );

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Surface content').isConnected).toBe(true);
  });

  it('never puts the caught error in front of the reader', () => {
    render(
      <SurfaceBoundary
        placement="window"
        recovery={{
          actions: [{ label: 'Reopen the workspace' }],
          detail: 'Reopening reloads this folder from disk.',
          message: 'The workspace could not be drawn.',
        }}
        surface="workspace"
      >
        <Surface message="internal detail nobody should read" />
      </SurfaceBoundary>,
    );

    expect(screen.getByText('The workspace could not be drawn.').isConnected).toBe(true);
    expect(screen.getByText('Reopening reloads this folder from disk.').isConnected).toBe(true);
    expect(screen.queryByText(/internal detail/)).toBeNull();
  });

  it('names the failing surface in the line it logs', () => {
    render(
      <SurfaceBoundary
        placement="pane"
        recovery={{ actions: [{ label: 'Retry' }], message: 'The agent view could not load.' }}
        surface="Agent"
      >
        <Surface />
      </SurfaceBoundary>,
    );

    expect(console.error).toHaveBeenCalledWith(
      'The Agent surface could not be drawn.',
      expect.any(Error),
      expect.any(String),
    );
  });

  // The loader here succeeds on its second call, which proves the wiring: the
  // recovery action reaches `lazySurface` and a fresh `lazy` calls `load`
  // again. A real chunk cannot recover this way, because the browser keeps a
  // module URL that failed to fetch as errored; see `lazy-surface.tsx`.
  it('sends the recovery action back into the loader', async () => {
    let attempt = 0;
    const load = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error('chunk unavailable'))
        : Promise.resolve({ default: (() => <p>Palette</p>) as ComponentType<object> });
    });
    const Palette = lazySurface<object>(load, {
      boundary: (retry, children) => (
        <SurfaceBoundary
          placement="overlay"
          recovery={{
            actions: [{ label: 'Retry', perform: retry }],
            message: 'Quick Open failed.',
          }}
          surface="Quick Open"
        >
          {children}
        </SurfaceBoundary>
      ),
    });

    render(<Palette />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect((await screen.findByText('Palette')).isConnected).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
