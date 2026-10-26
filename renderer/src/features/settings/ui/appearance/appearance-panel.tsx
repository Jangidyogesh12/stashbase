/** Application theme and interface preferences. */
import type { AppearancePort } from '@/features/settings/application/ports';
import {
  appearanceChange,
  DARK_THEME_CHOICES,
  isDarkTheme,
  isLightTheme,
  LIGHT_THEME_CHOICES,
  PRESET_ROWS,
} from '@/features/settings/domain/appearance';
import { useAppearance } from '@/features/settings/hooks/use-appearance';
import {
  SettingsGroup,
  SettingsList,
  SettingsPane,
  SettingsRow,
} from '@/features/settings/ui/rows';
import { FailureNotice } from '@/shared/ui/failure-notice';

import { ChoiceSelect } from './choice-select';
import { PresetRowView } from './preset-row-view';

export function AppearancePanel({ appearanceApi }: { appearanceApi: AppearancePort }) {
  const appearance = useAppearance(appearanceApi);
  const preferences = appearance.preferences;
  const loading = preferences === null;
  return (
    <SettingsPane title="Appearance">
      <SettingsGroup
        hint={appearance.failure ? <FailureNotice failure={appearance.failure} /> : undefined}
        title="Theme"
      >
        <SettingsList>
          <PresetRowView appearance={appearance} row={PRESET_ROWS.theme} />
          <SettingsRow
            detail="Used in light mode."
            title="Light theme"
            trail={
              <ChoiceSelect
                choices={LIGHT_THEME_CHOICES}
                disabled={loading}
                label="Light theme"
                onChoose={(value) => {
                  if (isLightTheme(value)) appearance.change(appearanceChange('lightTheme', value));
                }}
                value={preferences?.lightTheme ?? null}
              />
            }
          />
          <SettingsRow
            detail="Used in dark mode."
            title="Dark theme"
            trail={
              <ChoiceSelect
                choices={DARK_THEME_CHOICES}
                disabled={loading}
                label="Dark theme"
                onChoose={(value) => {
                  if (isDarkTheme(value)) appearance.change(appearanceChange('darkTheme', value));
                }}
                value={preferences?.darkTheme ?? null}
              />
            }
          />
        </SettingsList>
      </SettingsGroup>
      <SettingsGroup title="Interface">
        <SettingsList>
          <PresetRowView appearance={appearance} row={PRESET_ROWS.uiScale} />
          <PresetRowView appearance={appearance} row={PRESET_ROWS.reduceMotion} />
        </SettingsList>
      </SettingsGroup>
    </SettingsPane>
  );
}
