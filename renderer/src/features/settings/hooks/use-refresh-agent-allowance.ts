import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { settingsQueryKeys } from '@/features/settings/application/queries';

export function useRefreshAgentAllowance() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: settingsQueryKeys.agentAllowance });
  }, [client]);
}
