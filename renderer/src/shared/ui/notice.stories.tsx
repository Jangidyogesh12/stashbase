/** The floating card and the strip, drawn on their own rather than over a
 *  surface. The sentences are ones the app says, so each story reads as the
 *  notice a reader meets. The corner card is shown through
 *  `Feedback/Update Notice`. */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { LockKeyhole } from 'lucide-react';

import { FloatingNotice, NoticeStrip } from './notice';

const noop = () => undefined;

const meta = {
  parameters: { controls: { disable: true }, fluidCanvas: { width: '40rem' } },
  title: 'Feedback/Notice',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A document that did not open, with the one answer worth offering. */
export const FloatingWithAction: Story = {
  render: () => (
    <FloatingNotice actions={[{ label: 'Retry', onAct: noop }]} onDismiss={noop} role="alert">
      Could not open notes/plan.md. The file is no longer on disk.
    </FloatingNotice>
  ),
};

/** A refusal with nothing to take up: trying again is the reader's own move. */
export const FloatingDismissOnly: Story = {
  render: () => (
    <FloatingNotice onDismiss={noop} role="alert">
      Deep META Could Muse be the Inflection Point Market Looking for.pdf could not be opened.
    </FloatingNotice>
  ),
};

/** The strips a document can stand under: a label, a condition with its one
 *  answer, and a notice the reader can clear. */
export const Strips: Story = {
  render: () => (
    <div className="flex flex-col">
      <NoticeStrip className="text-muted-foreground">
        <LockKeyhole aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.5} />
        Read-only source from another project folder
      </NoticeStrip>
      <NoticeStrip action={{ label: 'Retry', onAct: noop }} role="status">
        Refresh failed. Showing the last loaded preview.
      </NoticeStrip>
      <NoticeStrip onDismiss={noop} role="status">
        This search match could not be located. The source may have changed.
      </NoticeStrip>
    </div>
  ),
};
