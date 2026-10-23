/** The window's notices, each composed for the place the Visual Style gives
 *  it, so the shell only hands every slot to its region. */
import type { ReactNode } from 'react';

import type { WorkspaceNoticePlacement } from '@/app/composition/folder/use-workspace-notices';
import { UpdateNotice, type UpdateNoticeViewModel } from '@/features/updates/public';

import { WorkspaceNoticeStrip } from './workspace-notice-strip';
import { CornerWorkspaceNotices, FloatingWorkspaceNotices } from './workspace-notices';

export interface WorkspaceNoticeSlots {
  /** The cards at the sidebar's foot: the shell's own, then the update. */
  corner: ReactNode;
  /** True while the corner holds a card, which a collapsed sidebar hides. */
  cornerShown: boolean;
  floating: ReactNode;
  strip: ReactNode;
}

export function workspaceNoticeSlots({
  notices,
  preview,
  update,
}: {
  notices: WorkspaceNoticePlacement;
  /** True while Developer tools shows an update in place of the real one. */
  preview: boolean;
  update: UpdateNoticeViewModel;
}): WorkspaceNoticeSlots {
  return {
    corner: (
      <>
        <CornerWorkspaceNotices notices={notices.corner} />
        <UpdateNotice notice={update} preview={preview} />
      </>
    ),
    cornerShown: notices.corner.length > 0 || (update.failure ?? update.offer) !== null,
    floating: <FloatingWorkspaceNotices notices={notices.floating} />,
    strip: <WorkspaceNoticeStrip notices={notices.strip} />,
  };
}
