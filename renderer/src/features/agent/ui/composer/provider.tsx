/** Selecting an Agent records project preference; access is requested on Send. */
import { DropdownContent, DropdownMenu } from '@/components/ui/dropdown';
import { MenuItem } from '@/components/ui/menu-item';
import { type Agent } from '@/features/agent/domain/agent-catalog';
import { AGENT_ICONS } from '@/shared/brand/agent-icons';

import { ComposerMenuTrigger } from './menu-trigger';
import { NARROW_LABEL, NARROW_TRIGGER } from './narrow';

export function AgentProviderControl({
  activeAgent,
  startsNewChat = false,
  agents,
  disabled,
  onAgentChange,
}: {
  activeAgent: Agent;
  startsNewChat?: boolean;
  /** The whole catalog, ready or not. */
  agents: Agent[];
  /** Whether a turn is streaming; the provider is fixed for its run. */
  disabled: boolean;
  onAgentChange(agent: Agent['id']): void;
}) {
  return (
    <DropdownMenu disabled={disabled}>
      <ComposerMenuTrigger
        className={NARROW_TRIGGER}
        disabled={disabled}
        icon={AGENT_ICONS[activeAgent.id]}
        label={`Provider: ${activeAgent.label}`}
      >
        <span className={NARROW_LABEL}>{activeAgent.label}</span>
      </ComposerMenuTrigger>
      <DropdownContent align="end" className="w-52" selectionAppearance="none" side="top">
        {agents.map((agent) => (
          <MenuItem
            checked={agent.id === activeAgent.id}
            {...(startsNewChat && agent.id !== activeAgent.id
              ? { description: 'Start a new chat' }
              : {})}
            icon={AGENT_ICONS[agent.id]}
            key={agent.id}
            label={agent.label}
            onSelect={() => onAgentChange(agent.id)}
          />
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}
