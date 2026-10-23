import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vite-plus/test';

import { askAbout } from '@/features/agent/application/ask-about';
import { createAgentWorkspaceRuntime } from '@/features/agent/application/workspace-runtime';
import { idleAgentSessionPort } from '@/test/fakes/agent';

import { useReferencedPassages } from './use-referenced-passages';

afterEach(cleanup);

it('follows the active chat and keeps references through queueing, pending follow-ups, and sent history', () => {
  let nextId = 0;
  const runtime = createAgentWorkspaceRuntime({
    autostart: false,
    createId: () => `chat-${++nextId}`,
    folderPath: null,
    port: idleAgentSessionPort(),
  });
  const source = { folderPath: '/project', path: 'essay.md' };
  const { result, unmount } = renderHook(() => useReferencedPassages(runtime));
  expect(result.current).toEqual([]);
  act(() => runtime.setWindowFolder('/project'));
  act(() => askAbout(runtime, source, 'Opening words'));
  expect(result.current).toEqual([{ source, markdown: 'Opening words' }]);
  const session = runtime.activeSession();
  const context = session.store.getState().context;
  act(() =>
    session.store.setState({
      context: [],
      queuedPrompts: [{ id: 'q', text: 'Revise', context, skill: null }],
    }),
  );
  expect(result.current).toEqual([{ source, markdown: 'Opening words' }]);
  act(() =>
    session.store.setState({
      queuedPrompts: [],
      steers: [{ id: 's', text: 'Revise', context, skill: null }],
    }),
  );
  expect(result.current).toEqual([{ source, markdown: 'Opening words' }]);
  act(() =>
    session.store.setState({
      steers: [],
      transcript: [{ kind: 'user', id: 'u', at: 1, text: 'Revise', context }],
      context,
    }),
  );
  expect(result.current).toHaveLength(1);
  act(() => runtime.newChat());
  expect(result.current).toEqual([]);
  act(() => runtime.activate(session.id));
  expect(result.current).toEqual([{ source, markdown: 'Opening words' }]);
  act(() => session.store.setState({ context: [], transcript: [] }));
  expect(result.current).toEqual([]);
  act(() => runtime.close(session.id));
  act(() => askAbout(runtime, source, 'New reference'));
  expect(result.current).toEqual([{ source, markdown: 'New reference' }]);
  unmount();
  runtime.dispose();
});
