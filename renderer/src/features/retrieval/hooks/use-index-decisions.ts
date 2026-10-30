import { useMutation } from '@tanstack/react-query';

import { retrievalFailure } from '@/features/retrieval/application/failure-messages';
import type { IndexDecisionPort } from '@/features/retrieval/application/ports';
import { useRequestSignals } from '@/shared/runtime/use-request-signals';

export type IndexDecisionAction = 'dismiss-warning' | 'retry-index';

/** Runs one index decision at a time for the folder; the status poll
 *  owned elsewhere reports the outcome, so nothing here is optimistic. The
 *  decision lane aborts its own previous call and every call on unmount. */
export function useIndexDecisions(api: IndexDecisionPort, folderPath: string) {
  const requestSignal = useRequestSignals<'decision'>();
  const mutation = useMutation({
    mutationFn: async (action: IndexDecisionAction) => {
      const signal = requestSignal('decision');
      switch (action) {
        case 'dismiss-warning':
          await api.dismissWarning(folderPath, signal);
          return;
        case 'retry-index':
          await api.resync(folderPath, signal);
      }
    },
  });
  return {
    error: mutation.isError ? retrievalFailure(mutation.error).message : null,
    pendingAction: mutation.isPending ? mutation.variables : null,
    run: (action: IndexDecisionAction) => mutation.mutate(action),
  };
}
