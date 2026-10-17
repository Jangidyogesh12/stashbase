import type { Meta, StoryObj } from '@storybook/react-vite';

import { agentRoleCallView } from '@/features/agent/domain/agent-role-call';
import type { AgentTranscriptBlock } from '@/features/agent/domain/session';

import { AgentRoleCall } from './role-call';

type ToolBlock = Extract<AgentTranscriptBlock, { kind: 'tool' }>;

const writer = {
  id: 'writer',
  label: 'Writer',
  toolName: 'write_draft',
  icon: 'pen-line',
  model: 'Claude Opus 5.5',
  options: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }],
};
const reviewer = {
  ...writer,
  id: 'reviewer',
  model: 'GPT-6.1 Sol',
  label: 'Reviewer',
  toolName: 'review_draft',
  icon: 'search-check',
};

const block = (overrides: Partial<ToolBlock>): ToolBlock => ({
  id: 'call',
  kind: 'tool',
  name: 'stashbase_write_draft',
  input: {
    task: 'Write a 1,200-word post on why we moved back to a monolith.',
    context:
      'For indie developers. Open with the launch outage. Keep "we were fooled by our own diagram".',
    files: ['/project/notes/postmortem.md', '/project/drafts/outline.md'],
  },
  status: 'done',
  ...overrides,
});

const meta = {
  component: AgentRoleCall,
  args: { status: 'done', view: agentRoleCallView(block({}), writer) },
  decorators: [
    (Story) => (
      <div className="w-[34rem]">
        <Story />
      </div>
    ),
  ],
  parameters: { controls: { disable: true }, fluidCanvas: { width: '38rem', minHeight: '10rem' } },
  title: 'Agent/Tool call',
} satisfies Meta<typeof AgentRoleCall>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Working: Story = {
  args: { status: 'running', view: agentRoleCallView(block({ status: 'running' }), writer) },
};

export const Wrote: Story = {
  args: {
    view: agentRoleCallView(
      block({
        result: 'We were fooled by our own diagram.\n\nThe outage started on launch night…',
      }),
      writer,
    ),
  },
};

export const Reviewed: Story = {
  args: {
    view: agentRoleCallView(
      block({
        name: 'stashbase_review_draft',
        result:
          '- The opening claims 40% downtime; the postmortem says 4%.\n- The second section assumes readers know what a service mesh is.\n- The ending repeats the introduction.',
      }),
      reviewer,
    ),
  },
};

export const Failed: Story = {
  args: {
    status: 'error',
    view: agentRoleCallView(
      block({
        status: 'error',
        result: 'This crew member or its model is not available right now.',
      }),
      writer,
    ),
  },
};
