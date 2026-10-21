import { useSyncExternalStore } from 'react';

function subscribe(listener: () => void) {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

const isVisible = () => document.visibilityState !== 'hidden';

/** Whether the window's page can currently be seen (including when unfocused). */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, isVisible);
}
