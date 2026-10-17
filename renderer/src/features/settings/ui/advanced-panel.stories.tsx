import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { EmbedderPort } from '@/features/settings/application/embedder-port';
import type { McpAccessPort } from '@/features/settings/application/ports';
import type { EmbedderState } from '@/features/settings/domain/embedder';

import { AdvancedPanel } from './advanced-panel';

function Queries({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const keyed: EmbedderState = {
  hasKey: true,
  model: 'text-embedding-3-small',
  provider: 'openai',
};

function embedder(state: EmbedderState): EmbedderPort {
  return {
    load: async () => state,
    removeKey: async () => ({ ...state, hasKey: false }),
    saveKey: async () => ({ warning: null }),
  };
}

/** This page never reads MCP access; the MCP page does, in its own story. */
const pending = () => new Promise<never>(() => {});
const mcp: McpAccessPort = {
  rotateToken: pending,
  setDockerAccess: pending,
  setDockerPort: pending,
  status: pending,
};

const meta = {
  title: 'Settings/AdvancedPanel',
  parameters: { fluidCanvas: { width: '40rem', minHeight: '16rem' } },
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

/** The Search row says whether search by meaning is on, and with whose key. */
export const SearchOn: Story = {
  render: () => <AdvancedPanel embedderApi={embedder(keyed)} mcpAccessApi={mcp} />,
};

/** Nothing configured: the row says what turning it on needs. */
export const SearchOff: Story = {
  render: () => (
    <AdvancedPanel embedderApi={embedder({ ...keyed, hasKey: false })} mcpAccessApi={mcp} />
  ),
};
