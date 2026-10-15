import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { McpAccessPort } from '@/features/settings/application/ports';
import { mcpAccess, mcpAccessPort, mcpHttpAccess } from '@/test/fakes/settings';
import { withQueryClient } from '@/test/query';

import { McpAccessPanel } from './mcp-access-panel';

const CONFIG = '{ "mcpServers": { "stashbase": { "command": "stashbase-mcp" } } }';

afterEach(cleanup);

function renderPanel(port: McpAccessPort) {
  return withQueryClient(<McpAccessPanel mcpAccessApi={port} />);
}

describe('McpAccessPanel', () => {
  it('shows the configuration block and copies it', async () => {
    const port = mcpAccessPort({ status: vi.fn(async () => mcpAccess({ config: CONFIG })) });
    renderPanel(port);

    // user-event installs its own clipboard stub over navigator, so the copy
    // is read back from there rather than from a spy it would have replaced.
    const user = userEvent.setup();
    expect(await screen.findByText(CONFIG)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Copy configuration' }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(CONFIG));
    expect(await screen.findByRole('button', { name: 'Copied' })).not.toBeNull();
  });

  it('keeps the bearer token out of the page until it is revealed', async () => {
    renderPanel(mcpAccessPort());
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'URL' }));

    expect(await screen.findByText('Bearer token')).not.toBeNull();
    expect(screen.queryByText('token-abc')).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Show token' }));
    expect(await screen.findByText('token-abc')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Hide token' })).not.toBeNull();
  });

  it('rotates the token only after the confirmation is accepted', async () => {
    const port = mcpAccessPort();
    renderPanel(port);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'URL' }));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Rotate token…' }));
    expect(await screen.findByText('Rotate MCP token?')).not.toBeNull();
    expect(port.rotateToken).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Rotate token' }));
    await waitFor(() => expect(port.rotateToken).toHaveBeenCalledWith(expect.any(AbortSignal)));
  });

  it('opens Docker access and reports a listener that did not come up', async () => {
    const port = mcpAccessPort();
    renderPanel(port);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'URL' }));

    await userEvent.setup().click(await screen.findByRole('switch', { name: 'Allow containers' }));
    await waitFor(() =>
      expect(port.setDockerAccess).toHaveBeenCalledWith(true, expect.any(AbortSignal)),
    );
  });

  it('names the reason a Docker listener is not up', async () => {
    const port = mcpAccessPort({
      status: vi.fn(async () =>
        mcpAccess({
          http: mcpHttpAccess({
            dockerAccess: true,
            dockerActive: false,
            dockerError: 'listen EADDRINUSE: address already in use 0.0.0.0:8848',
          }),
        }),
      ),
    });
    renderPanel(port);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'URL' }));

    expect(await screen.findByText('Not listening')).not.toBeNull();
    const statuses = await screen.findAllByRole('status');
    const listener = statuses.find((node) => node.textContent?.includes('Not listening'));
    expect(listener?.textContent).toContain('EADDRINUSE');
  });

  it('refuses a privileged Docker port and saves one in range', async () => {
    const port = mcpAccessPort();
    renderPanel(port);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'URL' }));
    const user = userEvent.setup();

    await user.click(screen.getByText('Docker port settings'));
    const field = await screen.findByRole('spinbutton', { name: 'Docker port' });
    await user.clear(field);
    await user.type(field, '80');
    expect(await screen.findByText('Enter a port from 1024 to 65535.')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save port' }));
    expect(port.setDockerPort).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, '9000');
    await user.click(screen.getByRole('button', { name: 'Save port' }));
    await waitFor(() =>
      expect(port.setDockerPort).toHaveBeenCalledWith(9000, expect.any(AbortSignal)),
    );
  });
});
