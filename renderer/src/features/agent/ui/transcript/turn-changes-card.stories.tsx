import type { Meta, StoryObj } from '@storybook/react-vite';

import { AgentTurnChangesCard } from './turn-changes-card';

const folderPath = '/project/notes';
const sourceFor = (path: string) =>
  path.startsWith(`${folderPath}/`)
    ? { folderPath, path: path.slice(folderPath.length + 1) }
    : null;

const meta = {
  component: AgentTurnChangesCard,
  args: {
    files: [
      {
        additions: 12,
        change: 'edited',
        deletions: 4,
        path: `${folderPath}/drafts/launch-plan.md`,
      },
      { additions: 28, change: 'created', deletions: 0, path: `${folderPath}/summary.md` },
      { additions: 0, change: 'deleted', deletions: 9, path: `${folderPath}/scratch.md` },
    ],
    onOpenSource: () => undefined,
    onReviewTurnChange: () => undefined,
    sourceFor,
    turnId: 'turn-1',
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-[34rem]">
        <Story />
      </div>
    ),
  ],
  parameters: { controls: { disable: true }, fluidCanvas: { width: '38rem', minHeight: '10rem' } },
  title: 'Agent/Turn changes',
} satisfies Meta<typeof AgentTurnChangesCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = {};

/** One edited file, which is what most turns leave. */
export const SingleEdit: Story = {
  args: {
    files: [{ additions: 3, change: 'edited', deletions: 1, path: `${folderPath}/plan.md` }],
  },
};

/** A settled turn starts with a three-file preview, even after many edits. */
export const ManyFiles: Story = {
  args: {
    files: [
      ...meta.args.files,
      ...Array.from({ length: 6 }, (_, index) => ({
        additions: index + 1,
        change: 'edited' as const,
        deletions: index,
        path: `${folderPath}/research/architecture/platform/background-material-${index + 1}.md`,
      })),
    ],
  },
};
