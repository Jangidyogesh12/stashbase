/** The trigger a composer menu opens from: a quiet compact button that names
 *  its selection, with a hover tooltip that keeps naming it once the pane is
 *  narrow enough to fold the button down to its icon. */
import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { DropdownTrigger } from '@/components/ui/dropdown';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { NARROWEST_TRIGGER } from './narrow';

export interface ComposerMenuTriggerProps {
  readonly children: ReactNode;
  readonly className: string;
  readonly disabled: boolean;
  readonly icon: LucideIcon;
  /** The accessible name and tooltip: what the menu is and what it holds. */
  readonly label: string;
  readonly onClick?: (() => void) | undefined;
}

export function ComposerMenuTrigger({
  children,
  className,
  disabled,
  icon,
  label,
  onClick,
}: ComposerMenuTriggerProps) {
  return (
    <Tooltip content={label} side="top">
      <DropdownTrigger
        render={
          <Button
            aria-label={label}
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
