import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { Providers } from '@/app/providers';
import { App } from '@/app/shell';
import type { UpdatesPort } from '@/features/updates/public';
import { appDependencies } from '@/test/fakes/app';
import { projectApi, projectRegistrySnapshot, workspaceAdapters } from '@/test/fakes/workspace';

/** Waits that follow the project and runtime catalog settling: a slow CI
 *  runner under coverage needs more than the one-second default. */
const SLOW = { timeout: 5_000 };

afterEach(cleanup);

const readyUpdate: UpdatesPort['read'] = async () => ({
  ok: true,
  state: {
    autoCheckEnabled: true,
    currentVersion: '2.8.0',
    status: { phase: 'ready', version: '2.8.1' },
  },
});

const updates: UpdatesPort = {
  check: readyUpdate,
  openReleasePage: readyUpdate,
  read: readyUpdate,
  runPrimaryAction: readyUpdate,
  setAutoCheck: readyUpdate,
  subscribe: () => () => undefined,
};

describe('workspace titlebar', () => {
  it('says Welcome while no folder is open instead of naming the hidden chat', async () => {
    const adapters = workspaceAdapters({
      project: projectApi({
        load: vi.fn(async () => projectRegistrySnapshot({ activeFolder: null, projects: [] })),
      }),
    });
    render(
      <Providers>
        <App
          dependencies={appDependencies({
            workspace: { adapters, revealLabel: 'Show in file manager' },
          })}
        />
      </Providers>,
    );

    expect(await screen.findByText('Welcome')).not.toBeNull();
    expect(screen.queryByText('Untitled')).toBeNull();
  });

  it('leaves the slot to the Chat pane once a folder is open', async () => {
    render(
      <Providers>
        <App dependencies={appDependencies()} />
      </Providers>,
    );

    // The Chat pane's own header labels itself "<title>, <runtime>"; the
    // new-chat button's label has no comma, so the pattern reaches only it.
    // A blank chat's name is a heading, not yet a rename control. The header
    // follows the project and the runtime catalog settling, which takes a
    // slow CI runner under coverage past the one-second default wait.
    expect(await screen.findByRole('heading', { name: /^Untitled, / }, SLOW)).not.toBeNull();
    // The slot starts on Welcome while the project is still loading, and the
    // word leaves through its exit fade rather than in the same frame.
    await waitFor(() => expect(screen.queryByText('Welcome')).toBeNull(), SLOW);
  });

  it("takes the chat's name away with the hidden panel and brings it back with it", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <App dependencies={appDependencies()} />
      </Providers>,
    );

    const chatName = /^Untitled, /;
    expect(await screen.findByRole('heading', { name: chatName }, SLOW)).not.toBeNull();
    const hide = screen.getByRole('button', { name: 'Hide chat panel' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');

    await user.click(hide);
    const show = screen.getByRole('button', { name: 'Show chat panel' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    // The name lives in the pane, so hiding the pane hides the name.
    await waitFor(() => expect(screen.queryByRole('heading', { name: chatName })).toBeNull(), SLOW);
    expect(screen.queryByText('Welcome')).toBeNull();

    await user.click(show);
    expect(await screen.findByRole('heading', { name: chatName }, SLOW)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Hide chat panel' })).not.toBeNull();
  });

  it('keeps New chat with the pane, so the corner holds the toggle alone while it is hidden', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <App dependencies={appDependencies()} />
      </Providers>,
    );

    const chatName = /^Untitled, /;
    expect(await screen.findByRole('heading', { name: chatName }, SLOW)).not.toBeNull();
    // With the pane showing, New chat is in its header.
    expect(screen.getByRole('button', { name: 'New chat' })).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Hide chat panel' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: chatName })).toBeNull(), SLOW);
    // The control leaves with the pane; the titlebar offers no second one.
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show chat panel' })).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show chat panel' }));
    expect(await screen.findByRole('button', { name: 'New chat' }, SLOW)).not.toBeNull();
  });
});

describe('Chats mode', () => {
  it('gives the chat the card: the titlebar names it, and the pane row, its actions, and the toggle leave', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <App dependencies={appDependencies()} />
      </Providers>,
    );
    const chatName = /^Untitled, /;
    // Documents mode: the pane's own row names the chat and carries its actions.
    expect(await screen.findByRole('heading', { name: chatName }, SLOW)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'New chat' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Chat history' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Hide chat panel' })).not.toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Chats' }));

    // The chat keeps its name, now in the window's title row, and nothing
    // beside it: the Chats panel manages history and New chat.
    const title = await screen.findByRole('heading', { name: chatName }, SLOW);
    expect(title.closest('header')).not.toBeNull(); // dom-contract: the title row is the window's one header
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Chat history' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Hide chat panel' })).toBeNull();
    // The folder header's fold and creates are the tree's; in Chats the
    // header is the name alone.
    expect(screen.queryByRole('button', { name: 'New file' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show chat panel' })).toBeNull();
    // The pane's New chat left with its row; the Chats panel's own start,
    // once its lazy surface lands, is the one left standing.
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Start new chat' }, SLOW)).not.toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Documents' }));

    expect(await screen.findByRole('button', { name: 'Chat history' }, SLOW)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Hide chat panel' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'New file' })).not.toBeNull();
    // The titlebar's copy leaves through its exit fade; the pane's row is
    // then the one that names the chat.
    await waitFor(() => expect(screen.getAllByRole('heading', { name: chatName })).toHaveLength(1));
    expect(screen.getByRole('heading', { name: chatName }).closest('header')).toBeNull();
  });

  it('marks the collapsed sidebar control while its foot holds a notice', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <App dependencies={appDependencies({ updates })} />
      </Providers>,
    );

    expect(
      await screen.findByText('StashBase 2.8.1 is ready to install.', {}, SLOW),
    ).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Hide files sidebar' }));
    // Collapsing takes the card off screen, so the control that brings it
    // back carries the mark, and says so to a screen reader.
    const show = await screen.findByRole('button', { name: 'Show files sidebar' });
    expect(show.getAttribute('aria-description')).toBe('Has notices');
    expect(screen.getByTestId('sidebar-notice-dot')).not.toBeNull();

    await user.click(show);
    await user.click(screen.getByRole('button', { name: 'Dismiss update notification' }));
    await user.click(screen.getByRole('button', { name: 'Hide files sidebar' }));
    await screen.findByRole('button', { name: 'Show files sidebar' });
    expect(screen.queryByTestId('sidebar-notice-dot')).toBeNull();
  }, 20_000);
});
