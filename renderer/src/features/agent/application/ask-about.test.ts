import { describe, expect, it } from 'vite-plus/test';

import { externalSource } from '@/shared/domain/external-source';
import { idleAgentSessionPort } from '@/test/fakes/agent';

import { askAbout, attachDroppedSource, releaseDroppedSource } from './ask-about';
import { createAgentWorkspaceRuntime } from './workspace-runtime';

describe('askAbout', () => {
  it('binds an asked-about passage to a chat in its folder and asks for the caret', () => {
    let nextId = 0;
    const runtime = createAgentWorkspaceRuntime({
      createId: () => `chat-${++nextId}`,
      folderPath: '/project/Research',
      port: idleAgentSessionPort(),
    });
    const source = { folderPath: '/project/Research', path: 'drafts/essay.md' };

    askAbout(runtime, source, '  The opening line.\n');
    const active = runtime.activeSession();
    expect(active.store.getState()).toMatchObject({
      composerFocusRequested: true,
      context: [{ kind: 'passage', quote: 'The opening line.', source }],
    });
    active.requestComposerFocus(false);
    askAbout(runtime, source, '   ');
    expect(active.store.getState().composerFocusRequested).toBe(false);

    const elsewhere = { folderPath: '/project/Plans', path: 'plan.md' };
    askAbout(runtime, elsewhere, 'Another folder.');
    expect(runtime.activeSession()).not.toBe(active);
    expect(runtime.activeSession().store.getState()).toMatchObject({
      context: [{ kind: 'passage', source: elsewhere }],
      scope: { kind: 'folder', path: '/project/Plans' },
    });
  });

  it('asks about an external passage in the chat beside it rather than a new folder chat', () => {
    let nextId = 0;
    const runtime = createAgentWorkspaceRuntime({
      createId: () => `chat-${++nextId}`,
      folderPath: '/project/Research',
      port: idleAgentSessionPort(),
    });
    const active = runtime.activeSession();
    const outside = externalSource('grant-token-abcdefghijklmn', '/Users/reader/notes.md');
    askAbout(runtime, outside, 'An outside line.');
    expect(runtime.activeSession()).toBe(active);
    expect(active.store.getState().context).toMatchObject([
      { kind: 'passage', quote: 'An outside line.', source: outside },
    ]);
  });
});

function workspace() {
  let nextId = 0;
  return createAgentWorkspaceRuntime({
    createId: () => `chat-${++nextId}`,
    folderPath: '/project/Research',
    port: idleAgentSessionPort(),
  });
}

describe('dropped files', () => {
  const outside = externalSource('grant-token-abcdefghijklmn', '/Users/reader/report.pdf');

  it('go to the chat beside them without a click and leave with their tab', () => {
    const runtime = workspace();
    const chat = attachDroppedSource(runtime, outside);
    const session = runtime.activeSession();
    expect(chat).toBe(session.id);
    expect(session.store.getState()).toMatchObject({
      composerFocusRequested: false,
      context: [{ dropped: true, format: 'pdf', kind: 'source', source: outside }],
    });
    releaseDroppedSource(runtime, chat, outside);
    expect(session.store.getState().context).toEqual([]);
  });

  it('leave a card the reader bound again by hand', () => {
    const runtime = workspace();
    const chat = attachDroppedSource(runtime, outside);
    const session = runtime.activeSession();
    session.removeContext(`source:external:${outside.path}`);
    session.addContext({ boundVersion: null, format: 'pdf', kind: 'source', source: outside });
    releaseDroppedSource(runtime, chat, outside);
    expect(session.store.getState().context).toHaveLength(1);
  });
});
