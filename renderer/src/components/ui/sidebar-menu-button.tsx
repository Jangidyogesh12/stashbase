/** A menu row's main button — the strip the scope measures, the overlays
 *  travel to, and the roving tabindex lands on.
 *
 *  It draws no background of its own: the hover and active fills are the
 *  menu's traveling overlays, so this element only owns its height, its type
 *  treatment and the exact trailing gutter its row's actions and badge
 *  reserve. */

'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import {
  forwardRef,
  useContext,
  useRef,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';

import { MenuRowLabel, RowIcon } from '@/components/ui/sidebar-menu-label';
import { useRowButton } from '@/components/ui/sidebar-menu-row';
import { MenuScopeContext } from '@/components/ui/sidebar-menu-scope';
import type { IconComponent } from '@/lib/icon-context';
import { mergeRefs } from '@/lib/merge-refs';
import { resolveSlotTemplate, slotElement } from '@/lib/slot-template';
import { cn } from '@/lib/utils';

const sidebarMenuButtonVariants = cva(
  // The trailing gutter is an exact reservation published by the row (see
  // rowGutterVars): --row-gutter at rest, --row-gutter-hover once
  // hover-revealed actions are showing. One rule per state instead of a class
  // per count/badge/reveal combination.
  'peer/menu-button relative z-10 flex w-full cursor-pointer items-center gap-2 pr-[var(--row-gutter)] pl-2 text-left transition-[padding] duration-fast outline-none select-none group-focus-within/menu-item:pr-[var(--row-gutter-hover)] group-focus-within/menu-sub-item:pr-[var(--row-gutter-hover)] group-hover/menu-item:pr-[var(--row-gutter-hover)] group-hover/menu-sub-item:pr-[var(--row-gutter-hover)] group-has-[[data-sidebar=menu-action]:is([data-state=open],[data-popup-open],[aria-expanded=true])]/menu-item:pr-[var(--row-gutter-hover)] group-has-[[data-sidebar=menu-action]:is([data-state=open],[data-popup-open],[aria-expanded=true])]/menu-sub-item:pr-[var(--row-gutter-hover)]',
  {
    variants: {
      variant: {
        default: '',
        outline: 'border border-border bg-background',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

interface SidebarMenuButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof sidebarMenuButtonVariants> {
  isActive?: boolean;
  /** Convenience shorthand for the common "one leading glyph, then a label"
   *  row: the icon is rendered ahead of `children` with the row's own lit
   *  colour and stroke weight. The icon slot takes exactly one glyph and
   *  nothing more. */
  icon?: IconComponent;
  /** The row's title. It gets the weight-animated treatment, so name it here
   *  rather than passing it as a child: `children` is for what rides BESIDE
   *  the title (a badge, a trailing control), which must stay outside the
   *  trimmed label box. A row with no title — one hosting an inline rename
   *  field — passes only children. */
  label?: ReactNode;
  /** Renders the row into this element instead of a `<button>` — a router
   *  link, say. Props, classes and refs merge onto it. */
  render?: ReactElement;
}

/**
 * `label` is the row's title and `children` is whatever rides beside it. Pass
 * `render` to host both in another element (a link), and `icon` as the
 * shorthand for a single leading glyph.
 */
const SidebarMenuButton = forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  (
    { isActive = false, variant, icon: Icon, label, render, className, children, ...props },
    ref,
  ) => {
    const scope = useContext(MenuScopeContext);
    const buttonRef = useRef<HTMLButtonElement | null>(null);

    const { item, itemShape, compact, iconSize, textClass, gutterVars } = useRowButton(
      buttonRef,
      isActive,
    );

    // A row's height is the ambient density, not a per-row choice: the three
    // named sizes this used to take had no caller and could contradict the
    // compact ladder the rest of the row already reads.
    const heightClass = compact ? 'h-7' : 'h-8';

    // Roving tabindex: the active rows' buttons are the menu's tab stops; with
    // no active row, the menu's first row keeps it keyboard-reachable.
    const row = item?.rowRef.current ?? null;
    const tabIdx = isActive
      ? 0
      : scope?.hasActive
        ? -1
        : row !== null && row === scope?.firstRowEl
          ? 0
          : -1;

    const { template, content } = resolveSlotTemplate(render, children);

    const inner = (
      <>
        {Icon && <RowIcon icon={Icon} size={iconSize} />}
        <MenuRowLabel extras={content} label={label} textClass={textClass} />
      </>
    );

    return slotElement(
      template,
      'button',
      {
        ref: mergeRefs(buttonRef, ref),
        type: template ? undefined : 'button',
        'data-sidebar': 'menu-button',
        'data-active': isActive ? 'true' : undefined,
        'aria-current': isActive ? 'page' : undefined,
        tabIndex: tabIdx,
        className: cn(sidebarMenuButtonVariants({ variant }), heightClass, itemShape, className),
        ...props,
        style: { ...gutterVars, ...props.style },
      },
      inner,
    );
  },
);
SidebarMenuButton.displayName = 'SidebarMenuButton';

export { SidebarMenuButton };
