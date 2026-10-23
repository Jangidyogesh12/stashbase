import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { useWorkspaceSession } from '@/features/workspace/public';
import { projectApi, sessionPersistence } from '@/test/fakes/workspace';
import { createTestQueryClient, queryWrapper } from '@/test/query';

import { useWorkspaceCommands } from './use-workspace-commands';

afterEach(() => {
  cleanup();
  globalThis.document.body.replaceChildren();
});

/** The window's chrome over the session the shell gives it, reached the way the
 *  shell reaches it rather than by building a session runtime by hand. */
function mountCommands() {
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  const view = renderHook(
    () => {
      const session = useWorkspaceSession(projectApi(), sessionPersistence());
      if (spies.length === 0) spies.push(vi.spyOn(session.runtime, 'setSidebarOpen'));
      return useWorkspaceCommands({
        documents: null,
        hostFailure: null,
        project: null,
        preparation: { dismissFailure: vi.fn(), failure: null, failureRequested: false },
        revisions: { dismiss: vi.fn(), failures: [], reviewTurnChange: vi.fn() },
        session,
        workspace: null,
      });
    },
    { wrapper: queryWrapper(createTestQueryClient()) },
  );
  return { ...view, setSidebarOpen: () => spies[0] };
}

describe('workspace commands: Settings', () => {
  it('opens to the first section, General, when no section is requested', () => {
    const { result } = mountCommands();

    act(() => result.current.settings.openSettings());

    expect(result.current.settings.open).toBe(true);
    expect(result.current.settings.section).toBe('general');
  });

  it('opens directly to a requested section and lets onSectionChange move between sections', () => {
    const { result } = mountCommands();

    act(() => result.current.settings.openSettings('mcp'));
    expect(result.current.settings.section).toBe('mcp');

    act(() => result.current.settings.onSectionChange('agents'));
    expect(result.current.settings.section).toBe('agents');
  });

  it('closes and restores focus to the control that opened it', async () => {
    const trigger = globalThis.document.createElement('button');
    globalThis.document.body.append(trigger);
    trigger.focus();
    const { result } = mountCommands();

    act(() => result.current.settings.openSettings());
    expect(result.current.settings.open).toBe(true);

    act(() => result.current.settings.close());
    expect(result.current.settings.open).toBe(false);
    await waitFor(() => expect(globalThis.document.activeElement).toBe(trigger));
  });
});

describe('workspace commands: sidebar navigator', () => {
  it('starts on Files', () => {
    const { result } = mountCommands();

    expect(result.current.navigator.selected).toBe('files');
  });

  it('selects a panel by name', () => {
    const { result } = mountCommands();

    act(() => result.current.navigator.select('outline'));

    expect(result.current.navigator.selected).toBe('outline');
  });

  it('opens the sidebar on Search and bumps the focus revision', () => {
    const { result, setSidebarOpen } = mountCommands();
    const before = result.current.navigator.focusRevision;

    act(() => result.current.navigator.openSearch());

    expect(setSidebarOpen()).toHaveBeenCalledWith(true);
    expect(result.current.navigator.selected).toBe('search');
    expect(result.current.navigator.focusRevision).toBe(before + 1);
  });

  it('bumps the focus revision again when Search is already showing', () => {
    const { result } = mountCommands();

    act(() => result.current.navigator.openSearch());
    const first = result.current.navigator.focusRevision;
    act(() => result.current.navigator.openSearch());

    expect(result.current.navigator.focusRevision).toBe(first + 1);
  });

  it('keeps the window unstarted until a project has settled', () => {
    const { result } = mountCommands();

    expect(result.current.started).toBe(false);
  });
});
