import { useEffect } from 'react';

import type { WindowLifecycleBridge } from '@/platform/electron/window-lifecycle';
import { listenForDesktopActivity } from '@/platform/telemetry';
import type { TelemetryEvent } from '@/protocols/http/telemetry';

export function useDesktopUsage(
  record: (event: TelemetryEvent) => void,
  mode: 'welcome' | 'documents' | 'chat',
  onInputActivity?: WindowLifecycleBridge['onInputActivity'],
) {
  useEffect(() => {
    record({ event: 'app_opened' });
  }, [record]);
  useEffect(() => listenForDesktopActivity(record, mode), [mode, record]);
  useEffect(() => {
    let minute = -1;
    return onInputActivity?.(() => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const current = Math.floor(Date.now() / 60_000);
      if (current === minute) return;
      minute = current;
      record({ event: 'app_active', mode });
    });
  }, [mode, onInputActivity, record]);
}
