import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { failureMessage } from '@/features/settings/application/failure-messages';
import { SettingsError, type AppearancePort } from '@/features/settings/application/ports';
import type { AppearancePreferences } from '@/features/settings/domain/appearance';
import { appearanceSurface } from '@/test/fakes/settings';
import { createTestQueryClient, queryWrapper } from '@/test/query';

import { useAppearance } from './use-appearance';

const DEFAULTS: AppearancePreferences = appearanceSurface();

interface OpenWrite {
  resolve(saved: AppearancePreferences): void;
  reject(error: unknown): void;
}

/** A port whose writes stay open until the test settles them, so two saves can
 *  genuinely overlap. */
function controlledPort(): { port: AppearancePort; writes: OpenWrite[] } {
  const writes: OpenWrite[] = [];
  const port: AppearancePort = {
    load: async () => DEFAULTS,
    update: () =>
      new Promise<AppearancePreferences>((resolve, reject) => {
        writes.push({ resolve, reject });
      }),
  };
  return { port, writes };
}

function mount(port: AppearancePort) {
  return renderHook(() => useAppearance(port), { wrapper: queryWrapper(createTestQueryClient()) });
}

const root = () => document.documentElement;

afterEach(() => {
  cleanup();
  root().classList.remove('light', 'dark');
  delete root().dataset.uiScale;
  delete root().dataset.readingTextSize;
});

describe('useAppearance', () => {
  it('shows nothing until the read answers', async () => {
    const { result } = mount({ load: async () => DEFAULTS, update: async () => DEFAULTS });

    expect(result.current.preferences).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.preferences).toEqual(DEFAULTS));
  });

  it('applies the change at once and then the answer the server stood behind', async () => {
    const port: AppearancePort = {
      load: async () => DEFAULTS,
      update: async (change) => ({ ...DEFAULTS, ...change, uiScale: 'large' }),
    };
    const { result } = mount(port);
    await waitFor(() => expect(result.current.preferences).not.toBeNull());

    act(() => result.current.change({ theme: 'dark' }));
    expect(root().classList.contains('dark')).toBe(true);

    await waitFor(() => expect(result.current.preferences?.uiScale).toBe('large'));
    expect(result.current.preferences?.theme).toBe('dark');
    expect(root().dataset.uiScale).toBe('large');
    expect(result.current.failure).toBeNull();
  });

  it('puts the confirmed value back when the save is refused', async () => {
    const { port, writes } = controlledPort();
    const { result } = mount(port);
    await waitFor(() => expect(result.current.preferences).not.toBeNull());

    act(() => result.current.change({ theme: 'dark' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await act(async () => {
      writes[0]?.reject(new SettingsError('invalid-request', 'refused'));
    });

    await waitFor(() =>
      expect(result.current.failure?.message).toBe(failureMessage('invalid-request')),
    );
    expect(result.current.preferences?.theme).toBe('system');
    expect(root().classList.contains('dark')).toBe(false);
  });

  it('keeps the newer optimistic choice while an earlier queued write fails', async () => {
    const { port, writes } = controlledPort();
    const { result } = mount(port);
    await waitFor(() => expect(result.current.preferences).not.toBeNull());

    act(() => result.current.change({ theme: 'dark' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    act(() => result.current.change({ theme: 'light' }));
    await waitFor(() => expect(result.current.preferences?.theme).toBe('light'));
    expect(writes).toHaveLength(1);

    await act(async () => {
      writes[0]?.reject(new SettingsError('unavailable', 'aborted'));
    });

    expect(result.current.preferences?.theme).toBe('light');
    expect(root().classList.contains('light')).toBe(true);
    expect(root().classList.contains('dark')).toBe(false);
    await waitFor(() => expect(writes).toHaveLength(2));
    await act(async () => writes[1]?.reject(new Error('Second write refused')));
    await waitFor(() => expect(result.current.preferences?.theme).toBe('system'));
  });
});

it('preserves Editor changes while a previous Appearance pane save fails', async () => {
  const { port, writes } = controlledPort();
  const wrapper = queryWrapper(createTestQueryClient());
  const appearance = renderHook(() => useAppearance(port), { wrapper });
  await waitFor(() => expect(appearance.result.current.preferences).not.toBeNull());
  act(() => appearance.result.current.change({ theme: 'dark' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  appearance.unmount();
  const editor = renderHook(() => useAppearance(port), { wrapper });
  await waitFor(() => expect(editor.result.current.preferences).not.toBeNull());
  act(() => editor.result.current.change({ lineWidth: 'wide' }));
  await act(async () => writes[0]?.reject(new Error('Theme save failed')));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(editor.result.current.preferences?.lineWidth).toBe('wide');
  await act(async () => writes[1]?.resolve({ ...DEFAULTS, lineWidth: 'wide' }));
  await waitFor(() => expect(editor.result.current.preferences?.lineWidth).toBe('wide'));
  expect(editor.result.current.preferences?.theme).toBe('system');
});
