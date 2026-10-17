/** The permission mode control: which of the product's four promises the
 *  next turn runs under. The rows describe the promise, never one runtime's
 *  behavior, and only the promises the runtime declares it honors are
 *  offered; the state reads on the trigger without opening the menu. */
import { Bolt, Compass, FilePenLine, MessageCircleQuestion } from 'lucide-react';

import { DropdownContent, DropdownMenu } from '@/components/ui/dropdown';
import { MenuItem } from '@/components/ui/menu-item';
import { AGENT_ACCESS_MODES, type AgentAccessMode } from '@/features/agent/domain/access';

import { ComposerMenuTrigger } from './menu-trigger';
import { NARROW_LABEL, NARROW_TRIGGER } from './narrow';

const MODE_TEXT = {
  default: { description: 'Asks before every change and command', label: 'Ask' },
  plan: { description: 'Reads and explores, changes nothing', label: 'Plan' },
  acceptEdits: { description: 'Edits inside the folder, asks for anything else', label: 'Edit' },
  auto: {
    description: 'Its own reviewer passes routine actions, pauses for risky ones',
    label: 'Auto',
  },
} as const satisfies Record<AgentAccessMode, { description: string; label: string }>;

// Plan explores, so it wears the compass.
const MODE_ICONS = {
  default: MessageCircleQuestion,
  plan: Compass,
  acceptEdits: FilePenLine,
  auto: Bolt,
} satisfies Record<AgentAccessMode, typeof MessageCircleQuestion>;

export function AgentPermissionMode({
  disabled,
  mode,
  modes,
  onChange,
}: {
  disabled?: boolean;
  mode: AgentAccessMode;
  /** The promises the runtime honors; rows outside it are not offered. */
  modes: readonly AgentAccessMode[];
  onChange(mode: AgentAccessMode): void;
}) {
  const active = MODE_TEXT[mode];
  const offered = AGENT_ACCESS_MODES.filter((entry) => modes.includes(entry));
  return (
    <DropdownMenu>
      <ComposerMenuTrigger
        className={NARROW_TRIGGER}
        description={active.description}
        disabled={disabled ?? false}
        icon={MODE_ICONS[mode]}
        label={`Permission mode: ${active.label}`}
      >
        <span className={NARROW_LABEL}>{active.label}</span>
      </ComposerMenuTrigger>
      <DropdownContent align="end" className="w-80" selectionAppearance="none" side="top">
        {offered.map((entry) => (
          <MenuItem
            checked={entry === mode}
            description={MODE_TEXT[entry].description}
            icon={MODE_ICONS[entry]}
            key={entry}
            label={MODE_TEXT[entry].label}
            onSelect={() => onChange(entry)}
          />
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}
