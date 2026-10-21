import { useCallback, useEffect } from 'react';

import { usePageVisible } from '@/shared/runtime/use-page-visible';
import { useWindowFocus } from '@/shared/runtime/use-window-focus';

/** External writers do not emit the host's tree revisions. Check only the
 *  visible document, retaining the query's last usable data on failure. */
export function useDocumentRefresh(
  active: boolean,
  refetch: (options: { cancelRefetch: boolean }) => Promise<unknown>,
) {
  const visible = usePageVisible();
  const refresh = useCallback(() => {
    // Focus and the timer can coincide; let a pending read finish.
    void refetch({ cancelRefetch: false });
  }, [refetch]);

  useWindowFocus(refresh, active && visible);

  useEffect(() => {
    if (!active || !visible) return;
    refresh();
    const timer = setInterval(refresh, 2_000);
    return () => clearInterval(timer);
  }, [active, refresh, visible]);
}
