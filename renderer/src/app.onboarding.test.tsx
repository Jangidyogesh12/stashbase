/** J01's whole window, from an empty project to a completed reply. Native
 * dialogs, accounts and agent processes are controlled ports: this proves
 * composition and continuity, not an OAuth exchange or provider availability. */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import type { AppDependencies } from '@/app/dependencies';
import { Providers } from '@/app/providers';
import { App } from '@/app/shell';
import { typeInto } from '@/test/dom';
import { agentDefinition, agentSessionPort } from '@/test/fakes/agent';
import { appDependencies } from '@/test/fakes/app';
import { SIGNED_IN_ACCOUNT, SIGNED_OUT_ACCOUNT } from '@/test/fakes/settings';
import { projectRegistrySnapshot } from '@/test/fakes/workspace';

const providers = [
  { id: 'stashbase', label: 'Default' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'antigravity', label: 'Antigravity' },
] as const;

type Provider = (typeof providers)[number];
type Lifecycle = AppDependencies['workspace']['adapters']['lifecycle'];
type Preferences = Awaited<
  ReturnType<NonNullable<AppDependencies['agent']['preferences']>['load']>
>;
type Command = ReturnType<typeof agentSessionPort>['sent'][number];

function onboarding(provider: Provider) {
  const dependencies = appDependencies();
  const folder = '/projects/First essay';
  let snapshot = projectRegistrySnapshot({ activeFolder: null, projects: [] });
  let receive: Parameters<Lifecycle['onEnterFolder']>[0] | undefined;
  let preferences: Preferences = [];
  let signedIn = false;
  let signingIn = false;
  let installed = false;
  let outdated = false;
  let updated = false;
  const prompts: string[] = [];
  const catalog = () => ({
    agents: providers.map((entry) =>
      agentDefinition({
        ...entry,
        ready: entry.id === provider.id && signedIn,
        needsSignIn:
          entry.id === provider.id && !signedIn && (installed || entry.id === 'stashbase'),
        updatable: entry.id !== 'stashbase',
        ...(entry.id === provider.id && signingIn && !signedIn
          ? {
              preparation: { step: 'sign-in' as const, note: 'Finish signing in in your browser.' },
            }
          : {}),
      }),
    ),
  });

  dependencies.workspace.adapters.project.load = vi.fn(async () => snapshot);
  dependencies.workspace.adapters.project.openFolder = vi.fn(async (path) => {
    expect(path).toBe(folder);
    snapshot = projectRegistrySnapshot({
      activeFolder: { path, name: 'First essay' },
      projects: [{ path, favorite: false, openedAt: '2026-10-26T00:00:00.000Z' }],
    });
    return snapshot;
  });
  dependencies.project.folderPicker.chooseFolder = vi.fn(async () => ({
    status: 'selected' as const,
    folderPath: folder,
  }));
  dependencies.workspace.adapters.lifecycle.onEnterFolder = (callback) => {
    receive = callback;
    return () => {
      if (receive === callback) receive = undefined;
    };
  };
  dependencies.workspace.adapters.lifecycle.enterFolder = vi.fn(async (path, signal) => {
    if (!receive) throw new Error('The window has no project receiver.');
    const failure = await receive(path, signal);
    if (failure) throw new Error(failure);
  });
  dependencies.agent.catalog = {
    listAgents: vi.fn(async () => catalog()),
    prepareAgent: vi.fn(async (id, action) => {
      expect(id).toBe(provider.id);
      if (action === 'bootstrap') installed = true;
      if (action === 'login') signingIn = true;
      if (action === 'update') updated = true;
      return catalog();
    }),
  };
  dependencies.agent.preferences = {
    load: async () => preferences,
    save: async (scope, agent) => {
      preferences = [{ scope: scope.path, agent }];
    },
  };
  dependencies.settings.accountApi.load = vi.fn(async () =>
    signedIn ? SIGNED_IN_ACCOUNT : SIGNED_OUT_ACCOUNT,
  );
  dependencies.settings.accountApi.signInStatus = vi.fn(async () => ({
    state: signedIn ? ('complete' as const) : ('pending' as const),
  }));
  dependencies.documents.openExternal = vi.fn(async () => true);
  const session = agentSessionPort({
    connect: vi.fn((request, listener) => {
      expect(signedIn).toBe(true);
      expect(request.agent).toBe(provider.id);
      expect(request.scope).toEqual({ kind: 'folder', path: folder });
      let closed = false;
      queueMicrotask(() => {
        if (!closed) listener.onEvent({ kind: 'ready' });
      });
      return {
        close: () => {
          closed = true;
        },
        send: (command: Command) => {
          if (command.kind !== 'prompt') return true;
          prompts.push(command.text);
          queueMicrotask(() => {
            if (closed) return;
            listener.onEvent({ kind: 'identified', id: `${provider.id}-conversation` });
            listener.onEvent({ kind: 'turn-started' });
            if (outdated && !updated) {
              listener.onEvent({
                kind: 'failed',
                failure: 'runtime-outdated',
                message: 'Update this runtime to continue.',
              });
              return;
            }
            listener.onEvent({ kind: 'text', delta: `${provider.label} reply: ${command.text}` });
            listener.onEvent({ kind: 'turn-ended', isError: false });
          });
          return true;
        },
      };
    }),
  });
  dependencies.agent.session = session.port;
  return {
    dependencies,
    prompts,
    signIn: () => {
      signedIn = true;
    },
    requireUpdate: () => {
      outdated = true;
    },
    mount: () =>
      render(
        <Providers>
          <App dependencies={dependencies} />
        </Providers>,
      ),
  };
}

afterEach(() => {
  cleanup();
  delete document.body.dataset.bootSettled;
});

it.each(providers)(
  '$label: open an empty project, sign in, receive a reply, update if needed, and return',
  async (provider) => {
    const fixture = onboarding(provider);
    const user = userEvent.setup();
    const firstWindow = fixture.mount();
    await user.click(await screen.findByRole('button', { name: 'Open a project' }));
    await screen.findByRole('textbox', { name: 'Message' }, { timeout: 5000 });
    if (provider.id !== 'stashbase') {
      await user.click(screen.getByRole('button', { name: 'Provider: Default' }));
      await user.click(await screen.findByRole('menuitemradio', { name: provider.label }));
    }
    const request = 'Help me outline an essay';
    typeInto(screen.getByRole('textbox', { name: 'Message' }), request);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    let dialog = within(await screen.findByRole('dialog'));
    // Declining access must keep the idea and must not launch any runtime.
    await user.click(dialog.getByRole('button', { name: 'Not now' }));
    expect(fixture.dependencies.agent.session.connect).not.toHaveBeenCalled();
    expect(fixture.dependencies.agent.catalog.prepareAgent).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe(request);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    dialog = within(await screen.findByRole('dialog'));
    await user.click(
      dialog.getByRole('button', {
        name: provider.id === 'stashbase' ? 'Sign in' : `Connect ${provider.label}`,
      }),
    );
    if (provider.id === 'stashbase') {
      await user.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    }
    const signInRequests = () =>
      provider.id === 'stashbase'
        ? vi.mocked(fixture.dependencies.documents.openExternal).mock.calls
        : vi
            .mocked(fixture.dependencies.agent.catalog.prepareAgent)
            .mock.calls.filter(([id, action]) => id === provider.id && action === 'login');
    await waitFor(() => expect(signInRequests()).toHaveLength(1));
    expect(fixture.prompts).toHaveLength(0);
    await act(async () => fixture.signIn());
    await screen.findByText(`${provider.label} reply: ${request}`, {}, { timeout: 5000 });
    expect(fixture.prompts).toEqual([request]);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();

    if (provider.id !== 'stashbase') {
      fixture.requireUpdate();
      typeInto(screen.getByRole('textbox', { name: 'Message' }), 'Use the newer model');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await user.click(await screen.findByRole('button', { name: `Update ${provider.label}` }));
      await screen.findByText(`${provider.label} reply: Use the newer model`);
    }
    expect(fixture.prompts).toEqual([
      request,
      ...(provider.id === 'stashbase' ? [] : ['Use the newer model', 'Use the newer model']),
    ]);
    expect(
      vi
        .mocked(fixture.dependencies.agent.catalog.prepareAgent)
        .mock.calls.filter(([, action]) => action === 'update')
        .map(([id]) => id),
    ).toEqual(provider.id === 'stashbase' ? [] : [provider.id]);

    const preparationCalls = vi.mocked(fixture.dependencies.agent.catalog.prepareAgent).mock.calls
      .length;
    const signInCalls = vi.mocked(fixture.dependencies.settings.accountApi.startSignIn).mock.calls
      .length;
    firstWindow.unmount();
    fixture.mount();
    await screen.findByRole('button', { name: `Provider: ${provider.label}` });
    typeInto(screen.getByRole('textbox', { name: 'Message' }), 'Continue my essay');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(`${provider.label} reply: Continue my essay`);
    expect(fixture.dependencies.agent.catalog.prepareAgent).toHaveBeenCalledTimes(preparationCalls);
    expect(fixture.dependencies.settings.accountApi.startSignIn).toHaveBeenCalledTimes(signInCalls);
    expect(fixture.prompts.filter((text) => text === 'Continue my essay')).toHaveLength(1);
  },
  20_000,
);
