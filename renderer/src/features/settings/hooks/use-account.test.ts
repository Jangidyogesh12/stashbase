import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { settingsQueryKeys } from '@/features/settings/application/queries';
import type { HostedSignInStatus } from '@/features/settings/domain/account';
import { accountPort, SIGNED_IN_ACCOUNT, SIGNED_OUT_ACCOUNT } from '@/test/fakes/settings';
import { createTestQueryClient, queryWrapper } from '@/test/query';

import { useAccount } from './use-account';

afterEach(cleanup);

function mount(port = accountPort(), openExternal = vi.fn()) {
  const queryClient = createTestQueryClient();
  const hook = renderHook(() => useAccount(port, openExternal), {
    wrapper: queryWrapper(queryClient),
  });
  return { hook, openExternal, port, queryClient };
}

describe('useAccount', () => {
  it('exposes failed initial reads and recovers without starting browser sign-in', async () => {
    const port = accountPort(SIGNED_OUT_ACCOUNT, {
      load: vi
        .fn()
        .mockRejectedValueOnce(new Error('Disconnected'))
        .mockResolvedValue(SIGNED_OUT_ACCOUNT),
    });
    const { hook, openExternal } = mount(port);
    await waitFor(() => expect(hook.result.current.failure).not.toBeNull());
    expect(hook.result.current.loading).toBe(false);
    act(() => hook.result.current.retryAccount());
    await waitFor(() => expect(hook.result.current.account).toEqual(SIGNED_OUT_ACCOUNT));
    expect(hook.result.current.failure).toBeNull();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('accepts only one sign-in until that browser wait is stopped', async () => {
    const { hook, port } = mount(accountPort(SIGNED_OUT_ACCOUNT));
    await waitFor(() => expect(hook.result.current.account).not.toBeNull());
    act(() => {
      hook.result.current.signInWithGoogle();
      hook.result.current.signInWithGoogle();
    });
    await waitFor(() => expect(hook.result.current.canStopWaiting).toBe(true));
    act(() => hook.result.current.signInWithGoogle());
    expect(port.startSignIn).toHaveBeenCalledTimes(1);
  });
  it('lets a pending send wait for sign-in and cancel without cancelling other observers', async () => {
    const { hook, port } = mount();
    await waitFor(() => expect(hook.result.current.account).not.toBeNull());
    const cancelled = new AbortController();
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = hook.result.current.signInAndWait(cancelled.signal);
      second = hook.result.current.signInAndWait(new AbortController().signal);
    });
    expect(hook.result.current.accessOpen).toBe(true);
    act(() => hook.result.current.signInWithGoogle());
    await waitFor(() => expect(hook.result.current.canStopWaiting).toBe(true));
    act(() => cancelled.abort());
    expect(await first).toBe(false);
    expect(hook.result.current.signInPending).toBe(true);
    expect(port.startSignIn).toHaveBeenCalledOnce();
    act(() => hook.result.current.stopWaiting());
    expect(await second).toBe(false);
    vi.mocked(port.signInStatus).mockResolvedValue({ state: 'complete' });
    let completed!: Promise<boolean>;
    act(() => {
      completed = hook.result.current.signInAndWait(new AbortController().signal);
    });
    act(() => hook.result.current.signInWithGoogle());
    await expect(completed).resolves.toBe(true);
  });

  it('opens the browser for a sign-in and holds one pending flag across the whole round trip', async () => {
    const port = accountPort(SIGNED_OUT_ACCOUNT, {
      signInStatus: vi.fn(async () => ({ state: 'complete' as const })),
    });
    const { hook, openExternal } = mount(port);
    await waitFor(() => expect(hook.result.current.account).toEqual(SIGNED_OUT_ACCOUNT));

    act(() => hook.result.current.signInWithGoogle());

    await waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith('https://accounts.example/sign-in'),
    );
    await waitFor(() => expect(hook.result.current.signInPending).toBe(false));
    expect(port.signInStatus).toHaveBeenCalledWith('flow-1', expect.any(AbortSignal));
    // The account is read again once the flow completes.
    await waitFor(() => expect(port.load).toHaveBeenCalledTimes(2));
  });

  it('re-reads what depends on the account once a sign-in lands', async () => {
    const port = accountPort(SIGNED_OUT_ACCOUNT, {
      signInStatus: vi.fn(async () => ({ state: 'complete' as const })),
    });
    const { hook, queryClient } = mount(port);
    await waitFor(() => expect(hook.result.current.account).not.toBeNull());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => hook.result.current.signInWithGoogle());

    await waitFor(() => expect(hook.result.current.signInPending).toBe(false));
    const invalidated = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(invalidated).toEqual(
      expect.arrayContaining([
        settingsQueryKeys.account,
        settingsQueryKeys.agentCatalog,
        settingsQueryKeys.agentAllowance,
      ]),
    );
  });

  it('keeps a failed sign-in visible as something the reader must act on', async () => {
    const port = accountPort(SIGNED_OUT_ACCOUNT, {
      signInStatus: vi.fn(async () => ({ error: 'Denied', state: 'error' as const })),
    });
    const { hook } = mount(port);
    await waitFor(() => expect(hook.result.current.account).not.toBeNull());

    act(() => hook.result.current.signInWithGoogle());

    await waitFor(() =>
      expect(hook.result.current.failure).toEqual({ message: 'Denied', tone: 'input' }),
    );
    expect(hook.result.current.signInPending).toBe(false);
  });

  it('writes the signed-out account a sign-out answers with', async () => {
    const port = accountPort(SIGNED_IN_ACCOUNT);
    const { hook } = mount(port);
    await waitFor(() => expect(hook.result.current.account?.signedIn).toBe(true));

    act(() => hook.result.current.signOut());

    await waitFor(() => expect(hook.result.current.account).toEqual(SIGNED_OUT_ACCOUNT));
    expect(port.signOut).toHaveBeenCalledOnce();
    expect(port.load).toHaveBeenCalledTimes(1);
  });

  it('leaves the browser wait when polling fails and allows another sign-in', async () => {
    const port = accountPort(SIGNED_OUT_ACCOUNT, {
      signInStatus: vi.fn(async () => {
        throw new Error('Disconnected');
      }),
    });
    const { hook } = mount(port);
    await waitFor(() => expect(hook.result.current.account).not.toBeNull());
    act(() => hook.result.current.signInWithGoogle());
    await waitFor(() => expect(port.signInStatus).toHaveBeenCalledOnce());
    await waitFor(() => expect(hook.result.current.signInPending).toBe(false));
    expect(hook.result.current.failure).not.toBeNull();
    act(() => hook.result.current.signInWithGoogle());
    await waitFor(() => expect(port.startSignIn).toHaveBeenCalledTimes(2));
  });

  it('stops polling and ignores a late response after the reader stops waiting and retries', async () => {
    let finish: ((status: HostedSignInStatus) => void) | undefined;
    const pending = new Promise<HostedSignInStatus>((resolve) => {
      finish = resolve;
    });
    let pollSignal: AbortSignal | undefined;
    let attempts = 0;
    const port = accountPort(SIGNED_OUT_ACCOUNT, {
      startSignIn: vi.fn(async () => ({
        flowId: `flow-${++attempts}`,
        url: 'https://accounts.example/sign-in',
      })),
      signInStatus: vi.fn(async (id, signal) => {
        if (id !== 'flow-1') return { state: 'pending' as const };
        pollSignal = signal;
        return pending;
      }),
    });
    const { hook } = mount(port);
    await waitFor(() => expect(hook.result.current.account).not.toBeNull());
    act(() => hook.result.current.signInWithGoogle());
    await waitFor(() => expect(port.signInStatus).toHaveBeenCalledOnce());
    act(() => hook.result.current.stopWaiting());
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.canStopWaiting).toBe(false);
    expect(pollSignal?.aborted).toBe(true);

    act(() => hook.result.current.signInWithGoogle());
    await waitFor(() =>
      expect(port.signInStatus).toHaveBeenCalledWith('flow-2', expect.any(AbortSignal)),
    );
    await act(async () => {
      finish?.({ state: 'complete' });
      await pending;
    });
    expect(hook.result.current.signInPending).toBe(true);
    expect(port.load).toHaveBeenCalledOnce();
  });
});
