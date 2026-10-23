import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { createAgentWorkspaceRuntime } from '@/features/agent/test-support';
import {
  createDocumentTabsRuntime,
  type ExternalFileOpening,
  type ExternalFilePort,
} from '@/features/documents/public';
import { createWorkspaceRuntime } from '@/features/workspace/test-support';
import { externalSource } from '@/shared/domain/external-source';
import { idleAgentSessionPort } from '@/test/fakes/agent';
import { documentTabsRuntimeOptions, externalFilesApi, sourceApi } from '@/test/fakes/documents';
import { RESEARCH_FOLDER, workspaceRuntimeOptions } from '@/test/fakes/workspace';
import { createTestQueryClient, queryWrapper } from '@/test/query';

import { droppedFilesMessage, useExternalFiles } from './use-external-files';

afterEach(cleanup);

const folderPath = RESEARCH_FOLDER.path;
const outside = externalSource('grant-token-abcdefghijklmn', '/Users/reader/Desktop/notes.md');

/** `prepare` answers the pane's open, as preparation does: a sentence when
 *  the file cannot open, or null. */
function setup(open: ExternalFilePort['open'], prepare?: () => Promise<string | null>) {
  const workspace = createWorkspaceRuntime(workspaceRuntimeOptions({ folder: RESEARCH_FOLDER }));
  const documents = createDocumentTabsRuntime(
    documentTabsRuntimeOptions({
      api: sourceApi(),
      folderPath,
      generation: 1,
      ...(prepare ? { prepare } : {}),
    }),
  );
  let nextChat = 0;
  const agent = createAgentWorkspaceRuntime({
    createId: () => `chat-${++nextChat}`,
    folderPath,
    port: idleAgentSessionPort(),
  });
  const externalFiles = externalFilesApi({ open: vi.fn(open) });
  const hook = renderHook(() => useExternalFiles({ agent, documents, externalFiles, workspace }), {
    wrapper: queryWrapper(createTestQueryClient()),
  });
  return {
    agent,
    documents,
    dispose() {
      documents.dispose();
      workspace.dispose();
      agent.dispose();
    },
    externalFiles,
    hook,
  };
}

describe('useExternalFiles', () => {
  it('opens a dropped file in place, hands it to the chat, and ends both with its tab', async () => {
    const { agent, documents, dispose, externalFiles, hook } = setup(async () => ({
      kind: 'external',
      source: outside,
    }));

    act(() => hook.result.current.dropFiles?.([new File(['# Notes'], 'notes.md')]));

    await vi.waitFor(() => expect(documents.openSources()).toEqual([outside]));
    expect(agent.activeSession().store.getState().context).toMatchObject([
      { dropped: true, kind: 'source', source: outside },
    ]);
    // Dropping is the reader's own act: the tab stays rather than being a preview.
    expect(documents.store.getState().tabs[0]?.preview).toBe(false);

    await act(() => documents.closeSource(outside));
    expect(externalFiles.revoke).toHaveBeenCalledWith(outside);
    expect(agent.activeSession().store.getState().context).toEqual([]);
    dispose();
  });

  it('opens a file already in the project as itself', async () => {
    const { documents, dispose, externalFiles, hook } = setup(async () => ({
      kind: 'project',
      path: 'drafts/plan.md',
    }));

    act(() => hook.result.current.dropFiles?.([new File(['# Plan'], 'plan.md')]));

    await vi.waitFor(() =>
      expect(documents.openSources()).toEqual([{ folderPath, path: 'drafts/plan.md' }]),
    );
    await act(() => documents.closeSource({ folderPath, path: 'drafts/plan.md' }));
    expect(externalFiles.revoke).not.toHaveBeenCalled();
    dispose();
  });

  it('explains every refused file in one notice and opens nothing in their place', async () => {
    const refusals: Record<string, ExternalFileOpening> = {
      'clip.mp3': { kind: 'refused', name: 'clip.mp3', reason: 'copy-required' },
      folder: { kind: 'refused', name: 'folder', reason: 'directory' },
      'report.docx': { kind: 'refused', name: 'report.docx', reason: 'copy-required' },
    };
    const { documents, dispose, hook } = setup(
      async (file) =>
        refusals[file.name] ?? { kind: 'refused', name: file.name, reason: 'unavailable' },
    );

    act(() =>
      hook.result.current.dropFiles?.(
        ['report.docx', 'folder', 'clip.mp3'].map((name) => new File(['x'], name)),
      ),
    );

    await vi.waitFor(() => expect(hook.result.current.notice).not.toBeNull());
    // Files is where a file joins the project, so the notice points there
    // rather than offering a copy of its own.
    expect(hook.result.current.notice?.message).toBe(
      '2 files cannot open here: report.docx, clip.mp3. To add them to the project, drop them on Files. ' +
        'Folders cannot open here. To use a whole folder, open it as a project.',
    );
    expect(documents.openSources()).toEqual([]);

    act(() => hook.result.current.notice?.onDismiss());
    expect(hook.result.current.notice).toBeNull();
    dispose();
  });
});

describe('useExternalFiles open failures', () => {
  it('leaves a file the pane failed to open to the pane, so the drop says nothing twice', async () => {
    const { documents, dispose, hook } = setup(
      async () => ({ kind: 'external', source: outside }),
      async () => 'The file could not be prepared.',
    );

    act(() => hook.result.current.dropFiles?.([new File(['x'], 'notes.md')]));

    await vi.waitFor(() =>
      expect(documents.store.getState().openFailure?.message).toBe(
        'The file could not be prepared.',
      ),
    );
    expect(hook.result.current.notice).toBeNull();
    dispose();
  });
});

describe('droppedFilesMessage', () => {
  it('names a few files and counts the rest', () => {
    expect(
      droppedFilesMessage(
        ['a.docx', 'b.docx', 'c.docx', 'd.docx', 'e.docx'].map((name) => ({
          name,
          reason: 'copy-required' as const,
        })),
      ),
    ).toBe(
      '5 files cannot open here: a.docx, b.docx, c.docx and 2 more. To add them to the project, drop them on Files.',
    );
    expect(droppedFilesMessage([{ name: 'notes.md', reason: 'unavailable' }])).toBe(
      'notes.md could not be opened.',
    );
  });
});
