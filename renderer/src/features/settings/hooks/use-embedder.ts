/**
 * Reads and changes the search-by-meaning key.
 *
 * Every command gets its own abort lane, so removing a key cannot cancel a
 * save that is already running, and leaving the panel cancels them all.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { EmbedderPort } from '@/features/settings/application/embedder-port';
import { embedderQuery, settingsQueryKeys } from '@/features/settings/application/queries';
import {
  keyIsActive,
  type EmbedderProvider,
  type EmbedderState,
} from '@/features/settings/domain/embedder';
import {
  anyBusy,
  firstCommandFailure,
  useSettingsCommand,
} from '@/features/settings/hooks/use-settings-command';
import type { FailureView } from '@/shared/domain/feature-error';

/** What the search-by-meaning panel renders and can do. */
export interface EmbedderViewModel {
  readonly keyBusy: boolean;
  readonly keyFailure: FailureView | null;
  /** Saved, but StashBase could not verify the key yet. */
  readonly keyWarning: string | null;
  readonly loading: boolean;
  readonly savingKey: boolean;
  readonly state: EmbedderState | null;
  reload(): void;
  removeKey(): void;
  saveKey(input: { key: string; provider: EmbedderProvider }, onSaved: () => void): void;
}

export function useEmbedder(port: EmbedderPort): EmbedderViewModel {
  const queryClient = useQueryClient();
  const state = useQuery(embedderQuery(port));

  const saveKey = useSettingsCommand(
    'saveKey',
    ({ key, provider }: { key: string; provider: EmbedderProvider }, signal) =>
      port.saveKey(provider, key, signal),
    { onDone: () => void queryClient.invalidateQueries({ queryKey: settingsQueryKeys.embedder }) },
  );
  const removeKey = useSettingsCommand(
    'removeKey',
    (_input: void, signal) => port.removeKey(signal),
    {
      onDone: (next) => {
        queryClient.setQueryData(settingsQueryKeys.embedder, next);
      },
    },
  );

  return {
    keyBusy: anyBusy(saveKey, removeKey),
    keyFailure: firstCommandFailure(saveKey, removeKey),
    keyWarning: saveKey.result?.warning ?? null,
    loading: state.isPending,
    reload: () => void state.refetch(),
    removeKey: () => removeKey.run(),
    saveKey: (input, onSaved) => saveKey.run(input, onSaved),
    savingKey: saveKey.busy,
    state: state.data ?? null,
  };
}

/** The setting as last read, without the commands that change it. */
export function useEmbedderState(port: EmbedderPort): {
  loading: boolean;
  state: EmbedderState | null;
} {
  const state = useQuery(embedderQuery(port));
  return { loading: state.isPending, state: state.data ?? null };
}

/**
 * Whether search by meaning exists in this window: true once the reader's
 * own key answers embeddings, false once the source is known to be anything
 * else, and null until the source has been read at all. The window reads it
 * once and the search surfaces hide their meaning-based mode on anything but
 * true, so no folder ever shows a mode the reader did not turn on.
 */
export function useSearchKeyConfigured(port: EmbedderPort): boolean | null {
  const state = useQuery(embedderQuery(port));
  return state.data === undefined ? null : keyIsActive(state.data);
}
