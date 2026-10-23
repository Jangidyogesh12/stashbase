import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { SettingsMessage, SettingsRow } from '@/features/settings/ui/rows';
import type {
  NotificationPreferencesPort,
  NotificationStatus,
} from '@/shared/domain/notifications';

export function NotificationSystemSettings({
  port,
  settings,
}: {
  port: NotificationPreferencesPort;
  settings: NotificationStatus['systemSettings'];
}) {
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const open = async () => {
    if (opening) return;
    setOpening(true);
    setFailed(false);
    try {
      await port.openSettings();
    } catch {
      setFailed(true);
    } finally {
      setOpening(false);
    }
  };
  return (
    <>
      <SettingsRow
        title="System permission"
        detail={`Permission cannot be checked here. To allow notifications after declining: ${settings.instructions}`}
        trail={
          settings.canOpen && (
            <Button
              variant="tertiary"
              size="compact"
              disabled={opening}
              loading={opening}
              onClick={() => {
                void open();
              }}
            >
              Open system settings
            </Button>
          )
        }
      />
      {failed && (
        <SettingsMessage
          message="System settings could not be opened. Follow the steps above to open them manually."
          {...(settings.canOpen
            ? {
                onRetry: () => {
                  void open();
                },
              }
            : {})}
        />
      )}
    </>
  );
}
