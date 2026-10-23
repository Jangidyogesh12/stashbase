/**
 * What the sidebar notice volunteers about updating, and nothing more.
 *
 * The sidebar notice never decides what to say. The phase table owns every sentence,
 * every button word, and the decision whether a phase is worth interrupting
 * for, so this hook is left with the one question that is about the sidebar notice:
 * whether the reader still wants to hear it.
 */
import { useCallback, useState } from 'react';

import type { UpdatesPort } from '@/features/updates/application/ports';
import { updateOffer } from '@/features/updates/domain/update-offer';
import { updateStatusKey } from '@/features/updates/domain/update-status';
import { useUpdates } from '@/features/updates/hooks/use-updates';
import type { FailureView } from '@/shared/domain/feature-error';

export interface UpdateNoticeOffer {
  readonly actionLabel: string | null;
  readonly message: string;
  /** True when the action repeats a check that failed: a recovery, drawn
   *  outlined, rather than the offer's one solid answer. */
  readonly recovers?: boolean;
}

export interface UpdateNoticeViewModel {
  readonly failure: FailureView | null;
  /** null when the window has nothing to volunteer. */
  readonly offer: UpdateNoticeOffer | null;
  act(): void;
  dismiss(): void;
}

export function useUpdateNotice(port: UpdatesPort | null): UpdateNoticeViewModel {
  const { failure, run, state } = useUpdates(port);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const offer = updateOffer(state.status);
  const { action } = offer;
  // Dismissing must not lose updating altogether, so what is waved off is one
  // thing the window said, identified by phase and version. A later phase, or
  // the same phase about a newer version, is a different thing and comes back.
  const key = updateStatusKey(state.status);

  const act = useCallback(() => {
    if (!action) return;
    if (action.kind === 'primary') run((updater) => updater.runPrimaryAction());
    else run((updater) => updater.check());
  }, [action, run]);

  const dismiss = useCallback(() => setDismissed(key), [key]);

  return {
    act,
    dismiss,
    failure: dismissed === key ? null : failure,
    offer:
      offer.announce && dismissed !== key
        ? {
            actionLabel: action?.label ?? null,
            message: offer.sentence,
            recovers: action?.kind === 'check',
          }
        : null,
  };
}
