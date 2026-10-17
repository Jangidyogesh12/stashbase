import { useMemo } from 'react';

import type { FailureView } from '@/shared/domain/feature-error';
import type { WorkspaceNotice } from '@/shared/domain/workspace-notice';

/**
 * The notice strip the window shows for things the reader did not ask about
 * directly.
 *
 * Three owners can raise one: a preparation command the shell ran on the
 * reader's behalf, which they may dismiss; the host disagreeing about which
 * folder this window is on, which only resolves when the host answers again;
 * and a revision an agent parked that could not be shown. Nothing here offers
 * setup. The strip's only invitation is the sign-in banner, which
 * the settings feature owns and `WorkspaceNoticeStrip` appends after these.
 */
export function useWorkspaceNotices({
  dismissPreparationFailure,
  dismissRevisionFailure,
  hostFailure,
  preparationFailure,
  revisionFailures,
}: {
  dismissPreparationFailure: () => void;
  /** Drops one revision notice by its sentence, which is what the strip keys
   *  on. */
  dismissRevisionFailure: (message: string) => void;
  hostFailure: string | null;
  preparationFailure: FailureView | null;
  /** Proposals that were drained and could not be shown. The host has already
   *  forgotten them, so the strip is the reader's only account of them. */
  revisionFailures: readonly string[];
}): readonly WorkspaceNotice[] {
  return useMemo(() => {
    const notices: WorkspaceNotice[] = [];
    if (preparationFailure) {
      notices.push({
        action: null,
        dismissLabel: 'Dismiss',
        message: preparationFailure.message,
        onDismiss: dismissPreparationFailure,
        tone: preparationFailure.tone,
      });
    }
    // The host disagreeing about this window's folder is not the reader's
    // request coming back, so it is said as a capability that could not answer.
    if (hostFailure) {
      notices.push({
        action: null,
        dismissLabel: 'Dismiss',
        message: hostFailure,
        onDismiss: null,
        tone: 'capability',
      });
    }
    // A revision nobody asked for is StashBase failing to show what was
    // offered, not the reader's own request refused.
    for (const message of revisionFailures) {
      notices.push({
        action: null,
        dismissLabel: 'Dismiss',
        message,
        onDismiss: () => dismissRevisionFailure(message),
        tone: 'capability',
      });
    }
    return notices;
  }, [
    dismissPreparationFailure,
    dismissRevisionFailure,
    hostFailure,
    preparationFailure,
    revisionFailures,
  ]);
}
