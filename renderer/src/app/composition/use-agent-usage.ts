import { useCallback } from 'react';

import type { AppDependencies } from '@/app/dependencies';
import { useRefreshAgentAllowance } from '@/features/settings/public';

/** Local credit refresh runs independently of telemetry delivery and opt-out. */
export function useAgentUsage(record: AppDependencies['recordUsage']) {
  const refresh = useRefreshAgentAllowance();
  return useCallback(
    (event: Parameters<typeof record>[0]) => {
      if (event.event === 'agent_turn_finished' && event.runtime === 'stashbase') refresh();
      record(event);
    },
    [record, refresh],
  );
}
