import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Plug } from 'lucide-react';
import type { ReactNode } from 'react';
import { expect, screen, userEvent } from 'storybook/test';

import type { McpAccessPort } from '@/features/settings/application/ports';
import type { McpAccess, McpHttpAccess } from '@/features/settings/domain/mcp-access';
import { SettingsShell } from '@/features/settings/ui/shell';

import { McpAccessPanel } from './mcp-access-panel';

function Queries({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const config = `{
  "mcpServers": {
    "stashbase": {
      "command": "/Users/ada/Library/Application Support/StashBase/bin/stashbase-mcp",
      "args": ["--project", "default"]
    }
  }
}`;

const reachable: McpHttpAccess = {
  dockerAccess: false,
  dockerActive: false,
  dockerError: null,
  dockerPort: 8848,
  dockerUrl: 'http://host.docker.internal:8848/mcp',
  loopbackUrl: 'http://127.0.0.1:7860/mcp',
  settingsError: null,
  token: 'sbk_9f3c1d7a4e05b28c617d',
};

function port(http: McpHttpAccess): McpAccessPort {
  const access: McpAccess = {
    command: '/Users/ada/Library/Application Support/StashBase/bin/stashbase-mcp',
    config,
    http,
  };
  return {
    rotateToken: async () => ({ ...http, token: 'sbk_2b80e64af19c37d5ac0e' }),
    setDockerAccess: async (enabled) => ({ ...http, dockerAccess: enabled }),
    setDockerPort: async (next) => ({ ...http, dockerPort: next }),
    status: async () => access,
  };
}

const meta = {
  title: 'Settings/McpAccessPanel',
  parameters: { fluidCanvas: { width: '40rem', minHeight: '32rem' } },
  decorators: [
    (Story) => (
      <Queries>
        <Story />
      </Queries>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const LoopbackOnly: Story = {
  render: () => <McpAccessPanel mcpAccessApi={port(reachable)} />,
};

export const DockerListenerFailed: Story = {
  render: () => (
    <McpAccessPanel
      mcpAccessApi={port({
        ...reachable,
        dockerAccess: true,
        dockerActive: false,
        dockerError: 'listen EADDRINUSE: address already in use 0.0.0.0:8848',
      })}
    />
  ),
};

/** Run at a short desktop viewport too: DOM-only tests cannot detect overflow. */
export const InSettingsWindow: Story = {
  render: () => (
    <SettingsShell
      open
      onClose={() => undefined}
      onSectionChange={() => undefined}
      section="advanced"
      sections={[
        {
          id: 'advanced',
          label: 'Advanced',
          icon: Plug,
          available: true,
          render: () => (
            <McpAccessPanel
              mcpAccessApi={port({ ...reachable, dockerAccess: true, dockerActive: true })}
            />
          ),
        },
      ]}
    />
  ),
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    await userEvent.click(await screen.findByRole('tab', { name: 'URL' }));
    const details = await screen.findByText('Docker port settings');
    details.scrollIntoView({ block: 'nearest' });
    await userEvent.click(details);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(dialog.scrollHeight).toBe(dialog.clientHeight);
    expect(dialog.scrollTop).toBe(0);
    expect(
      screen.getByRole('heading', { name: 'Settings' }).getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(dialog.getBoundingClientRect().top);
  },
};
