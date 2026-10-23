import { describe, expect, it, vi } from 'vite-plus/test';

import {
  projectApi as api,
  projectLifecycle as lifecycle,
  projectRegistrySnapshot,
} from '@/test/fakes/workspace';

import { projectFailureMessage } from './failure-messages';
import { ProjectError } from './ports';
import { removeFolder } from './remove-folder';

/** What the fake project reports after an authoritative removal. */
const removed = projectRegistrySnapshot({ activeFolder: null, projects: [] });

describe('remove project folder', () => {
  it('crosses window release before the authoritative removal and notification', async () => {
    const calls: string[] = [];
    const project = api({
      removeFolder: vi.fn(async () => {
        calls.push('remove');
        return removed;
      }),
    });
    const native = lifecycle({
      prepareFolderRemoval: vi.fn(async () => {
        calls.push('prepare');
        return true;
      }),
      notifyFolderRemoved: vi.fn(async () => {
        calls.push('notify');
      }),
    });

    await expect(
      removeFolder(project, native, '/project/notes', new AbortController().signal),
    ).resolves.toEqual({ status: 'removed', snapshot: removed, warning: null });
    expect(calls).toEqual(['prepare', 'remove', 'notify']);
  });

  it('does not remove when an affected window cannot release the folder', async () => {
    const project = api();
    const native = lifecycle({ prepareFolderRemoval: vi.fn(async () => false) });

    await expect(
      removeFolder(project, native, '/project/notes', new AbortController().signal),
    ).resolves.toEqual({
      status: 'failed',
      message: 'A window could not release this project. Resolve its save error and try again.',
    });
    expect(project.removeFolder).not.toHaveBeenCalled();
  });

  it('keeps classified server failure local and reports notification lag after commit', async () => {
    const failedApi = api({
      removeFolder: vi.fn(async () => {
        throw new ProjectError('unavailable', 'HTTP 503 from /api/project');
      }),
    });
    await expect(
      removeFolder(failedApi, lifecycle(), '/project/notes', new AbortController().signal),
    ).resolves.toEqual({
      status: 'failed',
      message: projectFailureMessage('unavailable', 'removed'),
    });

    await expect(
      removeFolder(
        api(),
        lifecycle({ notifyFolderRemoved: vi.fn(async () => Promise.reject(new Error('ipc'))) }),
        '/project/notes',
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      status: 'removed',
      snapshot: removed,
      warning: 'The project was removed. Another window may take a moment to refresh.',
    });
  });
});
