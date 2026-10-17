import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { AppearancePort, SystemTextPort } from '@/features/settings/application/ports';
import type { TelemetryPort } from '@/features/settings/application/telemetry-port';
import { AppearancePanel } from '@/features/settings/ui/appearance/appearance-panel';
import {
  Disclosure,
  SettingsGroup,
  SettingsList,
  SettingsPane,
  SettingsRow,
} from '@/features/settings/ui/rows';
import type { NotificationPreferencesPort } from '@/shared/domain/notifications';
import type { SoftwareUpdateRow } from '@/shared/domain/software-update';
import { FailureNotice } from '@/shared/ui/failure-notice';

import { NotificationsGroup } from './notifications-group';
import { TelemetryGroup } from './telemetry-group';

export interface GeneralPanelProps {
  notifications?: NotificationPreferencesPort | undefined;
  appearanceApi?: AppearancePort | undefined;
  systemTextApi?: SystemTextPort | undefined;
  revisionPreview?: ReactNode;
  telemetryApi?: TelemetryPort | undefined;
  onOpenExternal?: ((href: string) => void) | undefined;
  /** Null where the build has no updater, and then the group is not shown. */
  softwareUpdate: SoftwareUpdateRow | null;
}

export function GeneralPanel({
  notifications,
  appearanceApi,
  revisionPreview,
  softwareUpdate,
  systemTextApi,
  telemetryApi,
  onOpenExternal,
}: GeneralPanelProps) {
  return (
    <SettingsPane title="General">
      {/* Appearance leads, followed by attention notifications and updates,
       *  checked now and then; then Privacy, set once. Developer, which only a
       *  development build shows, closes the page. */}
      {appearanceApi && (
        <AppearancePanel appearanceApi={appearanceApi} systemTextApi={systemTextApi} />
      )}
      {notifications && <NotificationsGroup port={notifications} />}
      {softwareUpdate && (
        <SettingsGroup
          hint={
            softwareUpdate.failure ? <FailureNotice failure={softwareUpdate.failure} /> : undefined
          }
          title="Software updates"
        >
          <SettingsList>
            <SettingsRow
              detail="StashBase checks in the background. You choose when to install."
              title="Check for updates automatically"
              trail={
                <Switch
                  checked={softwareUpdate.autoCheckEnabled}
                  // One command reaches the updater at a time, so a toggle
                  // offered mid-download would be silently dropped.
                  disabled={softwareUpdate.busy}
                  label="Check for updates automatically"
                  labelHidden
                  onToggle={() => softwareUpdate.setAutoCheck(!softwareUpdate.autoCheckEnabled)}
                />
              }
            />
            <SettingsRow
              detail={softwareUpdate.status}
              title={`Version ${softwareUpdate.version}`}
              trail={
                <Button
                  disabled={softwareUpdate.busy}
                  onClick={softwareUpdate.act}
                  size="compact"
                  variant="tertiary"
                >
                  {softwareUpdate.actionLabel}
                </Button>
              }
            />
          </SettingsList>
        </SettingsGroup>
      )}
      {telemetryApi && onOpenExternal && (
        <TelemetryGroup port={telemetryApi} onOpenExternal={onOpenExternal} />
      )}
      {revisionPreview && (
        <SettingsGroup title="Developer">
          <Disclosure summary="Document revision review">{revisionPreview}</Disclosure>
        </SettingsGroup>
      )}
    </SettingsPane>
  );
}
