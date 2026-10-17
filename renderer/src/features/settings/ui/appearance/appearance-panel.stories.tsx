import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { AppearancePort, SystemTextPort } from '@/features/settings/application/ports';
import type { AppearancePreferences } from '@/features/settings/domain/appearance';
import { SettingsPane } from '@/features/settings/ui/rows';
import { appearanceSurface } from '@/test/fakes/settings';

import { AppearancePanel } from './appearance-panel';

function Queries({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const saved: AppearancePreferences = appearanceSurface();

const systemText: SystemTextPort = {
  listFonts: async () => [
    { family: 'Georgia', monospace: false },
    { family: 'Courier New', monospace: true },
  ],
  spellcheckLanguages: async () => ['en-US', 'fr'],
};

const appearancePort: AppearancePort = {
  load: async () => saved,
  update: async (change) => ({ ...saved, ...change }),
};

/** The panel's groups live in General's pane, a column; drawn bare, they
 *  would sit side by side in the canvas. */
function AppearanceHarness() {
  return (
    <SettingsPane title="General">
      <AppearancePanel appearanceApi={appearancePort} systemTextApi={systemText} />
    </SettingsPane>
  );
}

const meta = {
  title: 'Settings/AppearancePanel',
  parameters: { fluidCanvas: { width: '40rem', minHeight: '20rem' } },
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

export const Default: Story = { render: () => <AppearanceHarness /> };
