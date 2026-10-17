import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SettingsGroup, SettingsList, SettingsRow } from '@/features/settings/ui/rows';
import type { NotificationKind, NotificationPreferencesPort } from '@/shared/domain/notifications';

const categories: { kind: NotificationKind; title: string; detail: string }[] = [
  {
    kind: 'agent-confirmation',
    title: 'Needs confirmation',
    detail: 'An Agent needs approval or an answer.',
  },
  {
    kind: 'agent-completed',
    title: 'Task completed',
    detail: 'An Agent finishes a turn successfully.',
  },
  {
    kind: 'agent-failed',
    title: 'Task failed',
    detail: 'An Agent turn fails or loses its connection. Stopping a task does not notify you.',
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
  return (
    <SettingsGroup title="Notifications">
      <SettingsList>
        <SettingsRow
          title="Enable desktop notifications"
          detail="Show system notifications while StashBase is in the background."
          trail={
            <Switch
              label="Enable desktop notifications"
              labelHidden
              checked={status?.enabled ?? false}
              disabled={busy || !status || !status.supported}
              onToggle={() => {
                if (status) void change({ enabled: !status.enabled });
              }}
            />
          }
        />
        {categories.map(({ kind, title, detail }) => (
          <SettingsRow
            key={kind}
            title={title}
            detail={detail}
            trail={
              <Switch
                label={title}
                labelHidden
                checked={status?.categories[kind] ?? false}
                disabled={busy || !status?.enabled || !status.supported}
                onToggle={() => {
                  if (status) void change({ kind, enabled: !status.categories[kind] });
                }}
              />
            }
          />
        ))}
        <SettingsRow
          title="System notifications"
          detail={
            !status
              ? 'Checking notification availability…'
              : !status.supported
                ? 'System notifications are unavailable on this device.'
                : status.delivery === 'failed'
                  ? 'The last notification could not be delivered. Check your system notification settings for StashBase.'
                  : 'Allow StashBase in your system notification settings. Focus or Do Not Disturb may silence alerts; system permission cannot be checked here.'
          }
        />
      </SettingsList>
      {(failed || query.isError) && (
        <p role="alert" className="text-caption text-destructive">
          Notification preferences could not be {failed ? 'saved' : 'loaded'}.
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              if (failed) void change(failed);
              else void query.refetch();
            }}
          >
            Retry
          </Button>
        </p>
      )}
    </SettingsGroup>
  );
}
