import { useCallback, useState } from 'react';

import { preparationFailure, type PreparationControlPort } from '@/features/preparation/public';
import type { FailureView } from '@/shared/domain/feature-error';
import type { SourceReference } from '@/shared/domain/source-reference';
import { useRequestSignals } from '@/shared/runtime/use-request-signals';

/** One lane per call and per subject: a second reprocess of the same file
 *  replaces the first, while reprocessing a different file leaves it running. */
type PreparationLane = `${'prepare' | 'reprocess' | 'sync'}:${string}`;

export interface PreparationCommands {
  /** Clears the notice once the reader has seen it. */
  dismissFailure(): void;
  /** The last refusal, as the sentence and the tone its notice says it in,
   *  or null while nothing has refused. */
  failure: FailureView | null;
  /** Whether that refusal answers a reprocess the reader asked for, rather
   *  than preparation run on their behalf; the two are placed differently. */
  failureRequested: boolean;
  /** Best-effort queueing for a document that was just opened. */
  prepare(source: SourceReference): void;
  /** Restarts preparation for one source. Never rejects; resolves once the
   *  call has settled, so the caller can refresh what it shows. */
  reprocess(source: SourceReference): Promise<void>;
  /** Reconciles one folder with its disk. Never rejects. An optional lifetime
   *  signal retires the request and its failure when its caller leaves scope. */
  sync(folderPath: string, lifetime?: AbortSignal): Promise<void>;
}

/**
 * The preparation calls the shell makes on the reader's behalf rather than
 * from a panel of its own.
 *
 * All three used to open an `AbortController` that nothing ever aborted and
 * then swallow the rejection, so a refused reprocess looked exactly like a
 * successful one, and switching folders left the old folder's calls running.
 * Every call now takes a lane signal — replaced by the next call on the same
 * subject, aborted for every subject on unmount — and a refusal becomes one
 * sentence the shell can show.
 */
export function usePreparationCommands(controlApi: PreparationControlPort): PreparationCommands {
  const openSignal = useRequestSignals<PreparationLane>();
  const [failure, setFailure] = useState<{ requested: boolean; view: FailureView } | null>(null);

  const report = useCallback((signal: AbortSignal, error: unknown, requested = false) => {
    if (!signal.aborted) setFailure({ requested, view: preparationFailure(error) });
  }, []);

  const prepare = useCallback(
    (source: SourceReference) => {
      const signal = openSignal(`prepare:${sourceKey(source)}`);
      void controlApi.prepare(source, signal).catch((error: unknown) => report(signal, error));
    },
    [controlApi, openSignal, report],
  );

  const reprocess = useCallback(
    async (source: SourceReference) => {
      const signal = openSignal(`reprocess:${sourceKey(source)}`);
      try {
        await controlApi.reprocess(source, signal);
      } catch (error: unknown) {
        report(signal, error, true);
      }
    },
    [controlApi, openSignal, report],
  );

  const sync = useCallback(
    async (folderPath: string, lifetime?: AbortSignal) => {
      const request = openSignal(`sync:${folderPath}`);
      const signal = lifetime ? AbortSignal.any([request, lifetime]) : request;
      try {
        await controlApi.sync(folderPath, signal);
      } catch (error: unknown) {
        report(signal, error);
      }
    },
    [controlApi, openSignal, report],
  );

  const dismissFailure = useCallback(() => setFailure(null), []);

  return {
    dismissFailure,
    failure: failure?.view ?? null,
    failureRequested: failure?.requested === true,
    prepare,
    reprocess,
    sync,
  };
}

/** Two sources in different folders can share a path, so a lane needs both. */
function sourceKey(source: SourceReference): string {
  return `${source.folderPath}::${source.path}`;
}
