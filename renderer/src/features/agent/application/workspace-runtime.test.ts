import { describe, expect, it, vi } from 'vite-plus/test';

import { agentContextPort, idleAgentSessionPort } from '@/test/fakes/agent';

import { createAgentWorkspaceRuntime } from './workspace-runtime';

const noop = (): void => undefined;

describe('AgentWorkspaceRuntime', () => {
  it('starts with one Default chat and reuses only a completely blank tab', () => {
    let nextId = 0;
    const runtime = createAgentWorkspaceRuntime({
      createId: () => `chat-${++nextId}`,
      folderPath: '/project/Research',
      port: idleAgentSessionPort(),
    });

    expect(runtime.store.getState().tabs).toMatchObject([
      {
        agent: 'stashbase',
        blank: true,
        id: 'chat-1',
        scope: { kind: 'folder', path: '/project/Research' },
      },
    ]);
    expect(runtime.newChat('codex').id).toBe('chat-1');
    runtime.activeSession().store.setState({ nativeSessionId: 'native-1' });
    expect(runtime.newChat('claude').id).toBe('chat-2');
  });

  it('shows scheduled tasks in the chat place until a chat is opened again', () => {
    let nextId = 0;
    const runtime = createAgentWorkspaceRuntime({
      createId: () => `chat-${++nextId}`,
      folderPath: '/project/Research',
      port: idleAgentSessionPort(),
    });
    const surface = () => runtime.store.getState().surface;
    expect(surface()).toBe('chat');

    runtime.showScheduledTasks(true);
    // A scheduled run's chat opens behind the list rather than over it.
    runtime.startBackgroundChat({
      agent: 'claude',
      scope: { kind: 'folder', path: '/project/Research' },
      title: 'Daily brief · Oct 16',
    });
    expect(surface()).toBe('scheduled-tasks');
    expect(runtime.store.getState().activeId).toBe('chat-1');

    // Opening the chat already in front brings it back too.
    runtime.activate('chat-1');
    expect(surface()).toBe('chat');
    runtime.showScheduledTasks(true);
    runtime.newChat();
    expect(surface()).toBe('chat');
  });

  it('focuses a chat in the selected folder without rebinding started work', () => {
    let nextId = 0;
    const runtime = createAgentWorkspaceRuntime({
      createId: () => `chat-${++nextId}`,
      folderPath: '/project/Research',
      port: idleAgentSessionPort(),
    });
    runtime.setWindowFolder('/project/Plans');
    expect(runtime.activeSession().store.getState().scope).toEqual({
      kind: 'folder',
      path: '/project/Plans',
    });

    runtime.activeSession().store.setState({ nativeSessionId: 'native-1' });
    const retainedId = runtime.activeSession().id;
    runtime.setWindowFolder('/project/Archive');
    expect(runtime.activeSession().id).not.toBe(retainedId);
    expect(runtime.activeSession().store.getState().scope).toEqual({
      kind: 'folder',
      path: '/project/Archive',
    });
    expect(runtime.session(retainedId)?.store.getState().scope).toEqual({
      kind: 'folder',
      path: '/project/Plans',
    });

    runtime.setWindowFolder('/project/Plans');
    expect(runtime.activeSession().id).toBe(retainedId);
  });

  it('validates bound context only for sessions in the published window folder', async () => {
    let nextId = 0;
    const resolve = vi.fn(async () => {
      throw new Error('unreachable');
    });
    const runtime = createAgentWorkspaceRuntime({
      context: agentContextPort({ resolve }),
      createId: () => `chat-${++nextId}`,
      folderPath: '/project/Research',
      port: idleAgentSessionPort(),
    });
    runtime.setScopeEnvironment({
      folderPath: '/project/Research',
      listing: { files: [], folders: [] },
      readiness: {},
      versions: {},
    });
    const missing = {
      boundVersion: null,
      format: 'md' as const,
      kind: 'source' as const,
      source: { folderPath: '/project/Research', path: 'gone.md' },
    };

    const inFolder = runtime.activeSession();
    inFolder.addContext(missing);
    await expect(inFolder.sendPrompt('Read it')).resolves.toEqual({ ok: false, reason: 'stale' });
    expect(resolve).not.toHaveBeenCalled();

    const elsewhere = runtime.newChat('codex', { kind: 'folder', path: '/project/Plans' });
    elsewhere.addContext({ ...missing, source: { folderPath: '/project/Plans', path: 'gone.md' } });
    await expect(elsewhere.sendPrompt('Read it')).resolves.toEqual({ ok: true });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('keeps blank drafts transport-free until active first use', () => {
    const sessionPort = idleAgentSessionPort();
    const runtime = createAgentWorkspaceRuntime({
      autostart: false,
      createId: () => 'chat-1',
      folderPath: '/project/Research',
      port: sessionPort,
    });

    expect(sessionPort.connect).not.toHaveBeenCalled();
    expect(runtime.activeSession().store.getState().connection.kind).toBe('draft');
    runtime.start(['stashbase', 'codex']);
    expect(sessionPort.connect).not.toHaveBeenCalled();

    runtime.newChat('codex');
    expect(sessionPort.connect).not.toHaveBeenCalled();

    runtime.startActive();
    expect(sessionPort.connect).toHaveBeenCalledOnce();
    expect(sessionPort.connect).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'codex' }),
      expect.anything(),
    );
  });

  it('advances local recency only when the user submits a prompt', () => {
    const runtime = createAgentWorkspaceRuntime({
      createId: () => 'chat-1',
      folderPath: '/project/Research',
      port: idleAgentSessionPort(),
    });
    const session = runtime.activeSession();

    session.store.setState({ transcript: [{ at: 40, id: 'one', kind: 'user', text: 'First' }] });
    expect(runtime.store.getState().tabs[0]?.lastModified).toBe(40);

    session.store.setState({
      transcript: [
        { at: 40, id: 'one', kind: 'user', text: 'First' },
        { id: 'two', kind: 'assistant', text: 'Second' },
      ],
    });
    expect(runtime.store.getState().tabs[0]?.lastModified).toBe(40);

    session.store.setState({ connection: { kind: 'live', turn: null } });
    expect(runtime.store.getState().tabs[0]?.lastModified).toBe(40);
  });

  it('keeps a restored chat at its recorded recency until a new prompt is sent', async () => {
    const sessionPort = idleAgentSessionPort();
    vi.mocked(sessionPort.replay).mockResolvedValue({
      effort: null,
      transcript: [
        { at: 30, id: 'one', kind: 'user', text: 'Yesterday' },
        { id: 'two', kind: 'assistant', text: 'Reply' },
      ],
    });
    const runtime = createAgentWorkspaceRuntime({
      createId: () => 'chat-1',
      folderPath: '/project/Research',
      port: sessionPort,
    });

    await runtime.restore({
      agent: 'stashbase',
      hasContent: true,
      id: 'native-1',
      lastModified: 41,
      scope: { kind: 'folder', path: '/project/Research' },
      title: 'Yesterday',
    });
    expect(runtime.store.getState().tabs[0]?.lastModified).toBe(41);
  });

  it('retires every removed-project chat without moving its scope', () => {
    let nextId = 0;
    const runtime = createAgentWorkspaceRuntime({
      createId: () => `chat-${++nextId}`,
      folderPath: '/project/Research',
      port: idleAgentSessionPort(),
    });
    const retained = runtime.activeSession();
    retained.store.setState({
      nativeSessionId: 'native-1',
      transcript: [{ kind: 'user', id: 'message-1', text: 'Keep this.' }],
    });
    const blank = runtime.newChat('codex', { kind: 'folder', path: '/project/Research' });

    runtime.retireFolder('/project/Research');

    expect(retained.store.getState().connection.kind).toBe('retired');
    expect(blank.store.getState().connection.kind).toBe('retired');
    expect(runtime.session(blank.id)?.store.getState().scope).toEqual({
      kind: 'folder',
      path: '/project/Research',
    });

    runtime.setWindowFolder('/project/Plans');
    expect(runtime.activeSession().store.getState().scope).toEqual({
      kind: 'folder',
      path: '/project/Plans',
    });
    expect(retained.store.getState().scope).toEqual({
      kind: 'folder',
      path: '/project/Research',
    });
  });

  it('keeps Default and the draft when another runtime becomes ready', () => {
    let nextId = 0;
    const runtime = createAgentWorkspaceRuntime({
      createId: () => `chat-${++nextId}`,
      folderPath: '/project/Research',
      port: idleAgentSessionPort(),
    });
    // Nothing is ready, so the first start leaves the chat on the default and
    // the reader writes the request anyway.
    runtime.start([]);
    runtime.activeSession().setDraft('Build wiki pages for this folder');
    runtime.activeSession().addContext({
      boundVersion: null,
      format: 'md',
      kind: 'source',
      source: { folderPath: '/project/Research', path: 'MISSION.md' },
    });

    runtime.start(['codex']);

    const state = runtime.activeSession().store.getState();
    expect(state.agent).toBe('stashbase');
    expect(state.draft).toBe('Build wiki pages for this folder');
    expect(state.context).toMatchObject([{ source: { path: 'MISSION.md' } }]);
    expect(runtime.store.getState().tabs).toHaveLength(1);
  });

  it('leaves a chat that has already spoken on the runtime it spoke to', () => {
    const runtime = createAgentWorkspaceRuntime({
      createId: () => 'chat-1',
      folderPath: '/project/Research',
      port: idleAgentSessionPort(),
    });
    runtime.start([]);
    // A native session is work the reader can see; rebinding it would silently
    // move a conversation to a runtime that never held it.
    runtime.activeSession().store.setState({ nativeSessionId: 'native-1' });

    runtime.start(['codex']);

    expect(runtime.activeSession().store.getState().agent).toBe('stashbase');
  });

  it('routes history mutations through the native agent and scope and reconciles open tabs', async () => {
    const sessionPort = idleAgentSessionPort();
    vi.mocked(sessionPort.rename).mockResolvedValue({
      agent: 'stashbase',
      hasContent: true,
      id: 'native-1',
      lastModified: 42,
      scope: { kind: 'folder', path: '/project/Research' },
      title: 'Renamed',
    });
    const runtime = createAgentWorkspaceRuntime({
      createId: () => 'chat-1',
      folderPath: '/project/Research',
      port: sessionPort,
    });
    const session = runtime.activeSession();
    session.store.setState({ nativeSessionId: 'native-1', title: 'Before' });
    const scope = { kind: 'folder' as const, path: '/project/Research' };
    const entry = {
      agent: 'stashbase' as const,
      hasContent: true,
      id: 'native-1',
      lastModified: 41,
      scope,
      title: 'Before',
    };
    const signal = new AbortController().signal;

    await runtime.renameHistory(entry, 'Renamed', signal);
    expect(session.store.getState().title).toBe('Renamed');
    expect(sessionPort.rename).toHaveBeenCalledWith(entry, 'Renamed', expect.any(AbortSignal));

    await runtime.removeHistory(entry, signal);
    expect(sessionPort.remove).toHaveBeenCalledWith(entry, expect.any(AbortSignal));
    expect(session.store.getState().connection.kind).toBe('disposed');
    expect(runtime.activeSession().isBlank()).toBe(true);
  });

  it('keeps the active conversation in the selected folder after deleting its last open chat', async () => {
    let nextId = 0;
    const sessionPort = idleAgentSessionPort();
    const runtime = createAgentWorkspaceRuntime({
      createId: () => `chat-${++nextId}`,
      folderPath: '/project/Research',
      port: sessionPort,
    });
    runtime.activeSession().store.setState({ nativeSessionId: 'research-chat' });
    runtime.setWindowFolder('/project/Plans');
    runtime.activeSession().store.setState({ nativeSessionId: 'plans-chat' });
    const entry = {
      agent: 'stashbase' as const,
      hasContent: true,
      id: 'plans-chat',
      lastModified: 42,
      scope: { kind: 'folder' as const, path: '/project/Plans' },
      title: 'Plans',
    };

    await runtime.removeHistory(entry, new AbortController().signal);

    expect(runtime.activeSession().store.getState().scope).toEqual(entry.scope);
    expect(runtime.activeSession().isBlank()).toBe(true);
  });

  it('refuses a history completion that lands after the window folder moved', async () => {
    let nextId = 0;
    let settle = noop;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const sessionPort = idleAgentSessionPort({
      remove: vi.fn(async () => {
        await pending;
      }),
      rename: vi.fn(async (entry) => {
        await pending;
        return { ...entry, title: 'Renamed' };
      }),
    });
    const runtime = createAgentWorkspaceRuntime({
      createId: () => `chat-${++nextId}`,
      folderPath: '/project/Research',
      port: sessionPort,
    });
    const session = runtime.activeSession();
    session.store.setState({ nativeSessionId: 'native-1', title: 'Before' });
    const entry = {
      agent: 'stashbase' as const,
      hasContent: true,
      id: 'native-1',
      lastModified: 41,
      scope: { kind: 'folder' as const, path: '/project/Research' },
      title: 'Before',
    };
    const signal = new AbortController().signal;

    const renaming = runtime.renameHistory(entry, 'Renamed', signal);
    const removing = runtime.removeHistory(entry, signal);
    runtime.setWindowFolder('/project/Plans');
    settle();
    await Promise.all([renaming, removing]);

    expect(sessionPort.rename).toHaveBeenCalledWith(entry, 'Renamed', expect.any(AbortSignal));
    expect(sessionPort.remove).toHaveBeenCalledWith(entry, expect.any(AbortSignal));
    expect(session.store.getState().title).toBe('Before');
    expect(session.store.getState().connection.kind).not.toBe('disposed');
  });
});

it('Welcome creates no session; entering a project creates its first chat', () => {
  const runtime = createAgentWorkspaceRuntime({
    createId: () => 'first',
    folderPath: null,
    port: idleAgentSessionPort(),
  });
  expect(runtime.store.getState().tabs).toEqual([]);
  expect(() => runtime.newChat()).toThrow('Open a project');
  runtime.setWindowFolder('/project/Research');
  expect(runtime.store.getState().tabs).toHaveLength(1);
  expect(runtime.activeSession().store.getState().scope.path).toBe('/project/Research');
  runtime.dispose();
});
