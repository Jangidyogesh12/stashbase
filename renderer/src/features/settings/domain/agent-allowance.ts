import type { AgentAllowance } from './agent-catalog';

export function reservedCreditsDetail(allowance: AgentAllowance): string | null {
  const percent = allowance.reservedPercent ?? 0;
  if (percent <= 0) return null;
  return `${percent < 1 ? '<1' : Math.round(percent)}% temporarily reserved`;
}
