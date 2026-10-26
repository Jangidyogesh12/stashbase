import type { PresetRow } from '@/features/settings/domain/appearance';
import { presetChange } from '@/features/settings/domain/appearance';
import type { AppearanceViewModel } from '@/features/settings/hooks/use-appearance';
import { SettingsRow } from '@/features/settings/ui/rows';

import { PresetChoice } from './preset-choice';

export function PresetRowView({
  appearance,
  row,
}: {
  appearance: AppearanceViewModel;
  row: PresetRow;
}) {
  const preferences = appearance.preferences;
  return (
    <SettingsRow
      detail={row.detail}
      title={row.title}
      trail={
        <PresetChoice
          choices={row.choices}
          disabled={preferences === null}
          label={row.title}
          onChoose={(value) => {
            const change = presetChange(row, value);
            if (change) appearance.change(change);
          }}
          value={preferences ? preferences[row.field] : null}
        />
      }
    />
  );
}
