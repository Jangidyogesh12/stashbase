import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { userEvent, within } from 'storybook/test';

import type { PrepareOutcome } from '@/features/bug-report/application/ports';
import { createBugReportReviewRuntime } from '@/features/bug-report/application/review-runtime';
import type { ReviewArtifact } from '@/features/bug-report/domain/review-session';
import {
  approvedReport,
  bugReportReviewPort,
  reviewArtifacts,
  reviewDraft,
  type FakeReviewPortOptions,
} from '@/test/fakes/bug-report';

import { BugReportReview } from './review-window';

interface HarnessProps {
  options?: FakeReviewPortOptions;
  prepare?: () => Promise<PrepareOutcome>;
}

const DEFAULT_OPTIONS: FakeReviewPortOptions = {};

/** One runtime per mounted story, held in state so a re-render does not
 *  reload the draft. */
function Harness({ options = DEFAULT_OPTIONS, prepare }: HarnessProps) {
  const [runtime] = useState(() =>
    createBugReportReviewRuntime(bugReportReviewPort(options, prepare ? { prepare } : {}), {
      closeWindow: () => undefined,
    }),
  );
  return <BugReportReview runtime={runtime} />;
}

const meta = {
  title: 'Bug Reporting/ReviewWindow',
  component: Harness,
  parameters: { fluidCanvas: { width: '44rem', minHeight: '32rem' }, ownsLandmarks: true },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const clickPrepare = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: 'Prepare report' }));
};

export const Reviewing: Story = {};

function unavailable(artifact: ReviewArtifact): ReviewArtifact {
  return { ...artifact, availability: { kind: 'unavailable' } };
}

export const ReviewingWithUnavailableArtifact: Story = {
  args: {
    options: {
      snapshot: {
        draft: reviewDraft({
          artifacts: reviewArtifacts().map((artifact) =>
            artifact.kind === 'screenshot' ? unavailable(artifact) : artifact,
          ),
        }),
        kind: 'reviewing',
      },
    },
  },
};

export const PreviewOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Preview for Application log' }),
    );
    await canvas.findByRole('group', { name: 'Sanitized bounded application-log excerpt' });
  },
};

export const Preparing: Story = {
  args: { prepare: () => new Promise<PrepareOutcome>(() => undefined) },
  play: async (context) => {
    await clickPrepare(context);
    await within(context.canvasElement).findByText('Checking and preparing the report…');
  },
};

export const Ready: Story = {
  play: async (context) => {
    await clickPrepare(context);
    await within(context.canvasElement).findByRole('heading', { name: 'Report ready' });
  },
};

export const ReadyHandoffFailed: Story = {
  args: {
    prepare: async () => ({
      failure: { kind: 'downloads-failed' },
      kind: 'approved-unprepared',
      report: approvedReport(),
    }),
  },
  play: async (context) => {
    await clickPrepare(context);
    await within(context.canvasElement).findByRole('button', { name: 'Retry' });
  },
};

export const Unavailable: Story = {
  args: { options: { refuse: { get: 'draft-gone' } } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('button', { name: 'Close' });
  },
};
