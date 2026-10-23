import type { Meta, StoryObj } from '@storybook/react-vite';

import type { AgentRuntimeUpdateView } from '@/features/agent/hooks/use-agent-runtime-update';

import { AgentUpgradeOfferCard } from './upgrade-offer';

function runtimeUpdate(overrides: Partial<AgentRuntimeUpdateView> = {}): AgentRuntimeUpdateView {
  return {
    busy: false,
    completed: false,
    completedBlockId: null,
    failure: null,
    label: 'Claude',
    progress: null,
    update: () => undefined,
    ...overrides,
  };
}

const meta = {
  title: 'Agent/UpgradeOffer',
  component: AgentUpgradeOfferCard,
  parameters: { fluidCanvas: { width: '48rem' } },
  args: {
    offer: { model: 'Opus 5.5', note: 'Update to 2.1.280+ to use Opus 5.5' },
    runtimeUpdate: runtimeUpdate(),
  },
} satisfies Meta<typeof AgentUpgradeOfferCard>;

export default meta;
type Story = StoryObj<typeof AgentUpgradeOfferCard>;

export const Offered: Story = {};

export const Updating: Story = {
  args: {
    runtimeUpdate: runtimeUpdate({
      busy: true,
      progress: 'Downloading the official Claude installer…',
    }),
  },
};

export const Failed: Story = {
  args: {
    runtimeUpdate: runtimeUpdate({
      failure: 'Claude could not be updated. Check your connection and try again.',
    }),
  },
};
