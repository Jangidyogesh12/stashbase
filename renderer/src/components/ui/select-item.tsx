/** SelectItem — one option row inside a Select popup. Base UI's Item owns the
 *  role, selection and typeahead; this layer carries the visuals, the
 *  proximity-hover registration, and the shared selection check.
 *
 *  It must render inside a SelectContent: the popup owns the row registry that
 *  gives the row its position, and a row measured against no surface would be
 *  a row the hover overlay could never find. */
'use client';

import { Select as SelectPrimitive } from '@base-ui/react/select';
import { forwardRef, type HTMLAttributes } from 'react';

import { MenuItemCheck } from '@/components/internal/menu-item-check';
import { menuRowTone } from '@/components/internal/menu-row-tone';
import { useProximityRow } from '@/components/internal/proximity-row';
import type { IconComponent } from '@/lib/icon-context';
import { useShape } from '@/lib/shape-context';
import { useSize } from '@/lib/size-context';
import { cn } from '@/lib/utils';

import { useSelectContent } from './select-content';
import { useSelectContext } from './select-root';

interface SelectItemProps extends HTMLAttributes<HTMLDivElement> {
  icon?: IconComponent;
  value: string;
  disabled?: boolean;
}

const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, children, icon: Icon, value, disabled = false, ...props }, ref) => {
    const selectCtx = useSelectContext();
    const contentCtx = useSelectContent();
    const shape = useShape();
    const sizeClasses = useSize();
    const compact = sizeClasses.variant === 'compact';
    const isChecked = selectCtx.value === value;

    // The row's position is derived from where it sits, and the checked row
    // marks itself, so a caller neither counts options nor tells the popup
    // which one the current value picked out.
    const {
      index,
      isActive,
      ref: rowRef,
      skipAnimation,
    } = useProximityRow<HTMLDivElement>(
      ref,
      {
        activeIndex: contentCtx.activeIndex,
        registerItem: contentCtx.registerItem,
        registry: contentCtx.itemRegistry,
      },
      isChecked,
    );

    return (
      <SelectPrimitive.Item
        value={value}
        disabled={disabled}
        label={typeof children === 'string' ? children : undefined}
        render={
          <div
            ref={rowRef}
            data-proximity-index={index}
            data-value={value}
            className={cn(
              // Fixed height (was py-2 around a 19.5px line box ≈ 35.5px) so
              // the text-box trim on the item text doesn't shrink the row.
              // shrink-0: the popup is a max-height flex column, so without it
              // a long list compresses rows to fit instead of scrolling.
              `relative z-10 flex ${sizeClasses.control} shrink-0 items-center ${sizeClasses.gap} ${shape.item} ${sizeClasses.itemPx} ${sizeClasses.text} cursor-pointer outline-none select-none`,
              'transition-[color] duration-fast',
              // The glyph below keeps the muted rest on its own.
              menuRowTone(isActive || isChecked),
              disabled && 'pointer-events-none opacity-50',
              className,
            )}
            {...props}
          />
        }
      >
        {Icon && (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={isActive || isChecked ? 2 : 1.5}
            className={cn(
              'shrink-0 transition-[color,stroke-width] duration-fast',
              isActive || isChecked ? 'text-foreground' : 'text-muted-foreground',
            )}
          />
        )}

        <SelectPrimitive.ItemText
          // py-1/-my-1 keeps truncate's overflow:hidden from clipping
          // ascenders/descenders outside the trimmed box.
          render={
            <span className="-my-1 min-w-0 flex-1 truncate py-1 [text-box:trim-both_cap_alphabetic]" />
          }
        >
          {children}
        </SelectPrimitive.ItemText>

        {/* Always-rendered fixed slot so the check appearing/disappearing
            never changes the row's intrinsic width — without it the whole
            popup resizes when a selection lands. */}
        <span aria-hidden className={cn('shrink-0', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')}>
          <MenuItemCheck
            checked={isChecked}
            className="text-foreground"
            size={sizeClasses.icon}
            skipAnimation={skipAnimation}
          />
        </span>
      </SelectPrimitive.Item>
    );
  },
);

SelectItem.displayName = 'SelectItem';

export { SelectItem };
