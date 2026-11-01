import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ProjectMathPort } from '@/features/settings/application/ports';
import { settingsQueryKeys } from '@/features/settings/application/queries';

type MathSetting = { scope: string; math_mode: boolean };

/** A project setting remains separate from appearance: it follows the active
 * directory identity and is safe to flip without touching document source. */
export function useProjectMath(port: ProjectMathPort, scope: string | null) {
  const client = useQueryClient();
  const key = settingsQueryKeys.projectMath(scope);
  const query = useQuery({
    enabled: scope !== null,
    queryFn: ({ signal }) => {
      if (scope === null) throw new Error('No project is open.');
      return port.load(scope, signal);
    },
    queryKey: key,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (mathMode: boolean) => {
      if (scope === null) throw new Error('No project is open.');
      return port.update(scope, mathMode, AbortSignal.timeout(30_000));
    },
    onMutate: async (mathMode) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<MathSetting>(key);
      if (scope) client.setQueryData<MathSetting>(key, { scope, math_mode: mathMode });
      return { previous };
    },
    onError: (_error, _mathMode, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
    },
    onSuccess: (saved) => client.setQueryData(key, saved),
  });
  return {
    enabled: query.data?.math_mode ?? false,
    loading: scope !== null && query.isPending,
    saving: mutation.isPending,
    setEnabled: (next: boolean) => {
      if (scope && !mutation.isPending) mutation.mutate(next);
    },
  };
}
