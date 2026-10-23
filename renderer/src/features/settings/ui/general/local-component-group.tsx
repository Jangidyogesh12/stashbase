import { Button } from '@/components/ui/button';
import type { LocalComponentViewModel } from '@/features/settings/hooks/use-local-component';
import { SettingsGroup, SettingsList, SettingsRow } from '@/features/settings/ui/rows';
import { FailureNotice } from '@/shared/ui/failure-notice';

export function LocalComponentGroup({ model }: { model: LocalComponentViewModel }) {
  return (
    <SettingsGroup title="Text extraction">
      <SettingsList>
        <SettingsRow
          title="PDF and image text extraction"
          detail={<span role="status">{model.description}</span>}
          trail={
            model.canRetry ? (
              <Button disabled={model.busy} onClick={model.retry} size="compact" variant="tertiary">
                Retry
              </Button>
            ) : undefined
          }
        />
      </SettingsList>
      {model.failure && (
        <>
          <FailureNotice failure={model.failure} />
          <Button onClick={model.reload} size="compact" variant="tertiary">
            Refresh status
          </Button>
        </>
      )}
    </SettingsGroup>
  );
}
