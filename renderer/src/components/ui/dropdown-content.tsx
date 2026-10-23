/** DropdownContent — the portalled popup panel.
 *
 *  Portal > Positioner > Popup carrying the exact inline-panel visuals: an
 *  Elevated surface, the shared row overlays, and the shared pointer/focus
 *  wiring. Children are wrapped in a `Menu.RadioGroup` so radio-style
 *  MenuItems (boolean `checked`) get a correct `aria-checked` from the row
 *  that marked itself checked.
 *
 *  Base UI's Menu owns the roles, roving highlight, typeahead and activation
 *  inside the popup; this module supplies the row wrapper it uses through
 *  `renderMenuItem` on the shared dropdown context, so MenuItem itself never
 *  names a primitive. */
'use client';

import { Menu } from '@base-ui/react/menu';
import { motion } from 'framer-motion';
import {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  type ReactNode,
  type ComponentProps,
} from 'react';

import { Elevated } from '@/components/ui/elevated';
import { mergeRefs } from '@/lib/merge-refs';
import { useShape } from '@/lib/shape-context';
import { useDomOrderRegistry, useMarkedIndex } from '@/lib/use-dom-order-registry';
import { cn } from '@/lib/utils';

import { useDropdownMenuContext } from './dropdown-menu';
import {
  MenuSurfaceOverlays,
  overlayRects,
  useMenuSurface,
  usePopupMotion,
} from './dropdown-surface';
import { DropdownContext, type MenuItemRenderOptions } from './menu-item';

type MenuPositionerProps = ComponentProps<typeof Menu.Positioner>;

/** What the popup hangs from: its trigger when none is named, another
 *  element, or a point. */
export type DropdownAnchor = NonNullable<MenuPositionerProps['anchor']>;

/** A point the popup hangs from, for the menu a right click opens where the
 *  pointer is rather than under a trigger. */
export function pointAnchor(x: number, y: number): DropdownAnchor {
  return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
}

interface DropdownContentProps {
  /** Names a menu that has no trigger to be named by, such as one a right
   *  click opens; Base UI otherwise names the popup from its trigger. */
  'aria-label'?: string;
  children: ReactNode;
  className?: string;
  /** Keeps radio semantics while allowing a consumer-specific selection cue. */
  selectionAppearance?: 'fill' | 'none';
  side?: MenuPositionerProps['side'];
  align?: MenuPositionerProps['align'];
  sideOffset?: number;
  /** Positions the menu against this element instead of its trigger, for a
   *  menu opened from inside a panel that should clear the whole panel. */
  anchor?: MenuPositionerProps['anchor'];
}

const DropdownContent = forwardRef<HTMLDivElement, DropdownContentProps>(
  (
    {
      className,
      children,
      selectionAppearance = 'fill',
      side = 'bottom',
      align = 'start',
      sideOffset = 6,
      anchor,
      'aria-label': ariaLabel,
    },
    ref,
  ) => {
    const { open, releaseOnExit } = useDropdownMenuContext();
    const shape = useShape();
    const containerRef = useRef<HTMLDivElement>(null);

    const surface = useMenuSurface(containerRef, { clearFocusRingOnPointerEnter: true });
    const { activeIndex, measureItems, registerItem, sessionRef } = surface;
    const popupMotion = usePopupMotion({ open, fromBottomEdge: side === 'top' });
    const itemRegistry = useDomOrderRegistry();
    // The checked row marks itself (see MenuItem), so the popup derives the
    // selected background and the radio-group value from the rows rather than
    // from an index a caller had to keep in step with them.
    const checkedIndex = useMarkedIndex(itemRegistry);

    // Measure items once the popup has mounted.
    useEffect(() => {
      if (!open) return;
      // Double rAF: first waits for React commit, second for layout
      let inner: number;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          measureItems();
        });
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }, [open, measureItems]);

    const { activeRect, checkedRect, focusRect } = overlayRects(surface, checkedIndex);
    // Inside the popup, Base UI's Menu.Item / Menu.RadioItem own the role,
    // aria-checked, tabIndex, roving highlight, typeahead, and Enter/Space/
    // click activation (activation synthesizes a click, so the row div's
    // onClick also fires for keyboard). The render div carries the Fluid
    // Functionalism visuals and the proximity-hover registration.
    const renderMenuItem = useCallback(
      ({
        radio,
        toggle,
        value,
        disabled,
        closeOnClick,
        label,
        element,
        children: itemChildren,
      }: MenuItemRenderOptions) =>
        toggle ? (
          <Menu.CheckboxItem
            checked={toggle.on}
            closeOnClick={closeOnClick}
            disabled={disabled}
            label={label}
            render={element}
          >
            {itemChildren}
          </Menu.CheckboxItem>
        ) : radio ? (
          <Menu.RadioItem
            closeOnClick={closeOnClick}
            disabled={disabled}
            label={label}
            render={element}
            value={value}
          >
            {itemChildren}
          </Menu.RadioItem>
        ) : (
          <Menu.Item closeOnClick={closeOnClick} disabled={disabled} label={label} render={element}>
            {itemChildren}
          </Menu.Item>
        ),
      [],
    );

    const contentCtx = useMemo(
      () => ({ registerItem, activeIndex, itemRegistry, renderMenuItem }),
      [registerItem, activeIndex, itemRegistry, renderMenuItem],
    );

    return (
      <Menu.Portal>
        <Menu.Positioner
          {...(anchor === undefined ? {} : { anchor })}
          side={side}
          align={align}
          sideOffset={sideOffset}
          className="z-50 outline-none"
        >
          <motion.div {...popupMotion} onAnimationComplete={releaseOnExit}>
            <DropdownContext.Provider value={contentCtx}>
              <Menu.Popup
                render={<Elevated offset={2} shadowLevel={3} ref={mergeRefs(containerRef, ref)} />}
                {...surface.surfaceProps}
                {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
                className={cn(
                  // min-w tracks the anchor, the trigger unless the caller
                  // names another, via the Positioner's --anchor-width var.
                  `relative flex max-h-[min(480px,var(--available-height))] w-72 max-w-full min-w-[var(--anchor-width)] flex-col gap-0.5 overflow-y-auto ${shape.container} p-1 outline-none select-none`,
                  className,
                )}
              >
                <MenuSurfaceOverlays
                  activeRect={activeRect ?? null}
                  checkedRect={(selectionAppearance === 'fill' ? checkedRect : null) ?? null}
                  focusRect={focusRect ?? null}
                  hoverOrigin={checkedRect ?? null}
                  hoverSession={sessionRef.current}
                />

                {/* display: contents keeps items direct flex children of the
                    popup so proximity measurement and gap layout still work,
                    while the group provides the radio value context. */}
                <Menu.RadioGroup value={checkedIndex ?? null} className="contents">
                  {children}
                </Menu.RadioGroup>
              </Menu.Popup>
            </DropdownContext.Provider>
          </motion.div>
        </Menu.Positioner>
      </Menu.Portal>
    );
  },
);

DropdownContent.displayName = 'DropdownContent';

export { DropdownContent };
