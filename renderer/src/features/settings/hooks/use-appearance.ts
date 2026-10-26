import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { settingsFailure } from '@/features/settings/application/failure-messages';
import type { AppearancePort } from '@/features/settings/application/ports';
import { appearanceQuery, settingsQueryKeys } from '@/features/settings/application/queries';
import type {
  AppearanceChange,
  AppearancePreferences,
} from '@/features/settings/domain/appearance';
import type { FailureView } from '@/shared/domain/feature-error';
import { publishAppearanceSurface } from '@/shared/runtime/appearance-surface';

export interface AppearanceViewModel {
  readonly preferences: AppearancePreferences | null;
  readonly loading: boolean;
  readonly failure: FailureView | null;
  change(change: AppearanceChange): void;
}

/** A window owns one save queue, shared by Settings panes and the reading menu.
 * Accepted edits outlive their presenting pane. Serialize host writes and rebase
 * pending patches after each outcome, so a failed theme never rolls back width. */
class AppearanceWrites {
  private confirmed: AppearancePreferences | null = null;
  private pending: AppearanceChange[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly client: QueryClient) {}

  async load(port: AppearancePort, signal: AbortSignal): Promise<AppearancePreferences> {
    if (this.pending.length) {
      await this.tail;
      signal.throwIfAborted();
      if (this.confirmed) return this.confirmed;
    }
    return port.load(signal);
  }

  private publish() {
    if (!this.confirmed) return;
    const next = { ...this.confirmed };
    for (const change of this.pending) Object.assign(next, change);
    this.client.setQueryData(settingsQueryKeys.appearance, next);
    publishAppearanceSurface(next);
  }

  save(port: AppearancePort, change: AppearanceChange): Promise<void> {
    if (!this.pending.length) {
      this.confirmed =
        this.client.getQueryData<AppearancePreferences>(settingsQueryKeys.appearance) ?? null;
    }
    if (!this.confirmed) return Promise.resolve();
    const cancelled = this.client.cancelQueries({ queryKey: settingsQueryKeys.appearance });
    this.pending.push(change);
    this.publish();
    const saved = this.tail.then(async () => {
      await cancelled;
      try {
        this.confirmed = await port.update(change, AbortSignal.timeout(30_000));
      } finally {
        this.pending.shift();
        this.publish();
      }
    });
    // The next edit must run even if its predecessor failed. The caller still
    // receives the original rejection for its failure notice.
    this.tail = saved.catch(() => {
      // swallowed: only the queue tail recovers; the caller receives saved.
    });
    return saved;
  }
}
const owners = new WeakMap<QueryClient, AppearanceWrites>();
function writesFor(client: QueryClient): AppearanceWrites {
  let owner = owners.get(client);
  if (!owner) {
    owner = new AppearanceWrites(client);
    owners.set(client, owner);
  }
  return owner;
}

export function useAppearance(port: AppearancePort): AppearanceViewModel {
  const owner = writesFor(useQueryClient());
  const preferences = useQuery({
    ...appearanceQuery(port),
    queryFn: ({ signal }) => owner.load(port, signal),
  });
  const update = useMutation({ mutationFn: (saved: Promise<void>) => saved });
  return {
    preferences: preferences.data ?? null,
    loading: preferences.isPending,
    failure: preferences.isError
      ? settingsFailure(preferences.error)
      : update.isError
        ? settingsFailure(update.error)
        : null,
    change: (change) => update.mutate(owner.save(port, change)),
  };
}
