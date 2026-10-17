import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Switch } from '@/components/ui/switch';
import {
  SettingsGroup,
  SettingsList,
  SettingsMessage,
  SettingsRow,
} from '@/features/settings/ui/rows';
import type { NotificationKind, NotificationPreferencesPort } from '@/shared/domain/notifications';

import { NotificationSystemSettings } from './notification-system-settings';

const categories: { kind: NotificationKind; title: string; detail: string }[] = [
  {
    kind: 'agent-confirmation',
    title: 'Needs confirmation',
    detail: 'When an Agent needs approval or an answer.',
  },
  {
    kind: 'agent-completed',
    title: 'Task completed',
    detail: 'When an Agent finishes a task.',
  },
  {
    kind: 'agent-failed',
    title: 'Task failed',
    detail: 'When a task cannot finish. Stopped tasks stay quiet.',
  },
];
type Change = { enabled: boolean; kind?: NotificationKind };
const queryKey = ['settings', 'notifications'] as const;

export function NotificationsGroup({ port }: { port: NotificationPreferencesPort }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey, queryFn: () => port.read(), retry: false });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Change | null>(null);
  useEffect(
    () =>
      port.onChanged((status) => {
        client.setQueryData(queryKey, status);
      }),
    [client, port],
  );
  const change = async (requested: Change) => {
    if (!query.data || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const status = requested.kind
        ? await port.setCategory(requested.kind, requested.enabled)
        : await port.setEnabled(requested.enabled);
      client.setQueryData(queryKey, status);
    } catch {
      setFailed(requested);
    } finally {
      setBusy(false);
    }
  };
  const status = query.data;
  // Use the shared Settings grammar: system failures stay quiet, disabled
  // choices recede, and OS guidance belongs below the list.
  return (
    <SettingsGroup
      title="Notifications"
      hint={
        status &&
        (!status.supported
          ? 'System notifications are unavailable on this device.'
          : !status.enabled
            ? 'Your choices are saved while notifications are off.'
            : 'System notification settings and Do Not Disturb also apply.')
      }
    >
      <SettingsList>
        {(!status || query.isError) && (
          <SettingsMessage
            message={
              query.isError
                ? 'Notification preferences could not be loaded.'
                : 'Loading notification preferences…'
            }
            {...(query.isError
              ? {
                  onRetry: () => {
                    void query.refetch();
                  },
                }
              : {})}
          />
        )}
        {status && (
          <>
            <SettingsRow
              title="Enable desktop notifications"
              titleTone={!status.supported ? 'muted' : 'default'}
              detail="Show system notifications while StashBase is in the background."
              trail={
                <Switch
                  label="Enable desktop notifications"
                  labelHidden
                  checked={status.enabled}
                  disabled={busy || !status.supported}
                  onToggle={() => {
                    void change({ enabled: !status.enabled });
                  }}
                />
              }
            />
            {categories.map(({ kind, title, detail }) => (
              <SettingsRow
                key={kind}
                title={title}
                titleTone={!status.enabled || !status.supported ? 'muted' : 'default'}
                detail={detail}
                trail={
                  <Switch
                    label={title}
                    labelHidden
                    checked={status.categories[kind]}
                    disabled={busy || !status.enabled || !status.supported}
                    onToggle={() => {
                      void change({ kind, enabled: !status.categories[kind] });
                    }}
                  />
                }
              />
            ))}
            <NotificationSystemSettings port={port} settings={status.systemSettings} />
            {status.delivery === 'failed' && (
              <SettingsMessage message="The last notification could not be delivered. Check StashBase in your system notification settings." />
            )}
            {failed && (
              <SettingsMessage
                message="Notification preferences could not be saved."
                onRetry={() => {
                  void change(failed);
                }}
              />
            )}
          </>
        )}
      </SettingsList>
    </SettingsGroup>
  );
}
