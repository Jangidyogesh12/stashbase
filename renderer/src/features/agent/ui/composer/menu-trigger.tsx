/** The trigger a composer menu or panel opens from: a quiet compact button
 *  that names its selection, with a hover tooltip that keeps naming it once the pane is
 *  narrow enough to fold the button down to its icon. */
import { Popover } from '@base-ui/react/popover';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { DropdownTrigger } from '@/components/ui/dropdown';
import { Tooltip } from '@/components/ui/tooltip';
import type { IconComponent } from '@/lib/icon-context';
import { cn } from '@/lib/utils';

import { NARROWEST_TRIGGER } from './narrow';

export interface ComposerMenuTriggerProps {
  readonly children: ReactNode;
  readonly className: string;
  /** Read after the label by assistive tech but kept out of the tooltip,
   *  which names only the selection. */
  readonly description?: string | undefined;
  readonly disabled: boolean;
  readonly icon: IconComponent;
  /** The accessible name and tooltip: what the control is and what it holds. */
  readonly label: string;
  readonly onClick?: (() => void) | undefined;
  /** Opens a panel rather than a menu: the trigger then belongs to the
   *  surrounding Popover instead of a DropdownMenu. */
  readonly popover?: boolean | undefined;
}

export function ComposerMenuTrigger({
  children,
  className,
  description,
  disabled,
  icon,
  label,
  onClick,
  popover = false,
}: ComposerMenuTriggerProps) {
  const Trigger = popover ? Popover.Trigger : DropdownTrigger;
  return (
    <Tooltip content={label} side="top">
      <Trigger
        render={
          <Button
            aria-label={description === undefined ? label : `${label}. ${description}`}
            className={cn(className, NARROWEST_TRIGGER)}
            disabled={disabled}
            leadingIcon={icon}
            {...(onClick ? { onClick } : {})}
            size="compact"
            trailingIcon={ChevronDown}
            variant="ghost"
          >
            {children}
          </Button>
        }
      />
    </Tooltip>
  );
}
