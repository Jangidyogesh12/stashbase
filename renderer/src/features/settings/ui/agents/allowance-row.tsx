import { reservedCreditsDetail } from '@/features/settings/domain/agent-allowance';
import type { AgentAllowance } from '@/features/settings/domain/agent-catalog';
import { ProgressBar, SettingsRow } from '@/features/settings/ui/rows';
import { clamp } from '@/shared/utils/clamp';

export function AllowanceRow({ allowance }: { allowance: AgentAllowance }) {
  const percent = clamp(Math.round(allowance.remainingPercent), 0, 100);
  const reset = allowance.windowEndsAt
    ? new Date(allowance.windowEndsAt).toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  const reserved = reservedCreditsDetail(allowance);

  return (
    <SettingsRow
      as="li"
      detail={`${percent}% available${reserved ? ` · ${reserved}` : ''} · Refills ${reset ?? '7 days after first use'}`}
      title="Credits"
    >
      <ProgressBar value={percent} />
    </SettingsRow>
  );
}
