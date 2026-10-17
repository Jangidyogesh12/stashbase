/** The notice strip: what a window volunteers, and what a reader waves off. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { UpdateRefusal, UpdateResult } from '@/features/updates/application/ports';
import type { UpdateState, UpdateStatus } from '@/features/updates/domain/update-status';

import { useUpdateNotice } from './use-update-notice';

function stateOf(status: UpdateStatus): UpdateState {
  return { autoCheckEnabled: true, currentVersion: '1.4.0', status };
}

function accepted(status: UpdateStatus): UpdateResult {
  return { ok: true, state: stateOf(status) };
}

function refused(kind: UpdateRefusal): UpdateResult {
  return { kind, ok: false };
}

/**
 * A port with a real subscription behind it: a test pushes a transition
 * through it, and unsubscribing takes the handler off the list, so `listeners`
 * says whether an unmounted hook is still being told things.
 *
 * `read` is what main already knows when the strip mounts; `answer` is what
 * every command answers with, which is the same state unless a test is about
 * a refusal.
 */
function harness(read: UpdateResult, answer: UpdateResult = read) {
  let handlers: ((state: UpdateState) => void)[] = [];
  const port = {
    check: vi.fn(async () => answer),
    openReleasePage: vi.fn(async () => answer),
    read: vi.fn(async () => read),
    runPrimaryAction: vi.fn(async () => answer),
    setAutoCheck: vi.fn(async (_enabled: boolean) => answer),
    subscribe: vi.fn((onState: (state: UpdateState) => void) => {
      handlers = [...handlers, onState];
      return () => {
        handlers = handlers.filter((handler) => handler !== onState);
      };
    }),
  };
  return {
    port,
    listeners: () => handlers.length,
    push: (status: UpdateStatus) => {
      for (const handler of handlers) handler(stateOf(status));
    },
  };
}

describe('useUpdateNotice', () => {
  it('subscribes, reads once, and volunteers exactly what the phase table says', async () => {
    const updates = harness(accepted({ phase: 'ready', version: '1.5.0' }));
    const { result } = renderHook(() => useUpdateNotice(updates.port));

    await waitFor(() => expect(result.current.offer).not.toBeNull());
    expect(updates.port.subscribe).toHaveBeenCalledTimes(1);
    expect(updates.port.read).toHaveBeenCalledTimes(1);
    expect(result.current.offer).toEqual({
      actionLabel: 'Restart to update',
      message: 'StashBase 1.5.0 is ready to install.',
    });
  });

  it('volunteers nothing in a phase the table keeps quiet about', async () => {
    const updates = harness(accepted({ phase: 'current' }));
    const { result } = renderHook(() => useUpdateNotice(updates.port));

    await waitFor(() => expect(updates.port.read).toHaveBeenCalled());
    expect(result.current.offer).toBeNull();

    // The state did arrive: the same window speaks up the moment it has
    // something worth interrupting for.
    act(() => updates.push({ phase: 'ready', version: '1.5.0' }));
    expect(result.current.offer?.message).toBe('StashBase 1.5.0 is ready to install.');
  });

  it('hides a dismissed offer and volunteers the next thing it has to say', async () => {
    const updates = harness(accepted({ phase: 'ready', version: '1.5.0' }));
    const { result } = renderHook(() => useUpdateNotice(updates.port));
    await waitFor(() => expect(result.current.offer).not.toBeNull());

    act(() => result.current.dismiss());
    expect(result.current.offer).toBeNull();

    act(() => updates.push({ phase: 'error' }));
    expect(result.current.offer?.message).toBe('StashBase could not finish the update.');
  });

  it('volunteers the same phase again when it names a newer version', async () => {
    const updates = harness(accepted({ phase: 'ready', version: '1.5.0' }));
    const { result } = renderHook(() => useUpdateNotice(updates.port));
    await waitFor(() => expect(result.current.offer).not.toBeNull());

    act(() => result.current.dismiss());
    act(() => updates.push({ phase: 'ready', version: '1.6.0' }));
    expect(result.current.offer?.message).toBe('StashBase 1.6.0 is ready to install.');
  });

  it('runs the primary action when the table names the action primary', async () => {
    const updates = harness(accepted({ phase: 'ready', version: '1.5.0' }));
    const { result } = renderHook(() => useUpdateNotice(updates.port));
    await waitFor(() => expect(result.current.offer?.actionLabel).toBe('Restart to update'));

    await act(async () => result.current.act());
    expect(updates.port.runPrimaryAction).toHaveBeenCalledTimes(1);
    expect(updates.port.check).not.toHaveBeenCalled();
  });

  it('asks again when the table names the action a check', async () => {
    const updates = harness(accepted({ phase: 'error' }));
    const { result } = renderHook(() => useUpdateNotice(updates.port));
    await waitFor(() => expect(result.current.offer?.actionLabel).toBe('Try again'));

    await act(async () => result.current.act());
    expect(updates.port.check).toHaveBeenCalledTimes(1);
    expect(updates.port.runPrimaryAction).not.toHaveBeenCalled();
  });

  it('names a refused command and leaves the offer standing', async () => {
    const updates = harness(
      accepted({ phase: 'ready', version: '1.5.0' }),
      refused('unauthorized'),
    );
    const { result } = renderHook(() => useUpdateNotice(updates.port));
    await waitFor(() => expect(result.current.offer).not.toBeNull());

    await act(async () => result.current.act());
    await waitFor(() =>
      expect(result.current.failure).toEqual({
        message: 'This window is not allowed to manage updates.',
        tone: 'capability',
      }),
    );
    // Nothing happened, so the window still has the same thing to offer.
    expect(result.current.offer?.message).toBe('StashBase 1.5.0 is ready to install.');
    act(() => result.current.dismiss());
    expect(result.current.offer).toBeNull();
    expect(result.current.failure).toBeNull();
  });

  it('stops listening on unmount, so a later transition reaches nothing', async () => {
    const updates = harness(accepted({ phase: 'current' }));
    const { result, unmount } = renderHook(() => useUpdateNotice(updates.port));
    await waitFor(() => expect(updates.port.read).toHaveBeenCalled());
    expect(updates.listeners()).toBe(1);

    unmount();
    expect(updates.listeners()).toBe(0);
    updates.push({ phase: 'ready', version: '1.5.0' });
    expect(result.current.offer).toBeNull();
  });

  it('is an inert surface with no port behind it', () => {
    const { result } = renderHook(() => useUpdateNotice(null));

    act(() => {
      result.current.act();
      result.current.dismiss();
    });
    expect(result.current.offer).toBeNull();
    expect(result.current.failure).toBeNull();
  });
});
