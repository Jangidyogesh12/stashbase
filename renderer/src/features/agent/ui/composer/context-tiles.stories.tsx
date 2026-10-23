import type { Meta, StoryObj } from '@storybook/react-vite';

import { SentContextTiles } from './context-tiles';

const meta = {
  title: 'Agent/Context tiles',
  component: SentContextTiles,
  args: {
    align: 'start',
    items: [
      { kind: 'transient', name: 'expired.png', path: '/tmp/expired.png' },
      {
        kind: 'transient',
        name: 'unreadable.png',
        path: '/tmp/unreadable.png',
        previewUrl: 'data:image/png;base64,bm90IGFuIGltYWdl',
      },
    ],
  },
} satisfies Meta<typeof SentContextTiles>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnavailableHistoryPreviews: Story = {};
