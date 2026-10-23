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
import { useRef, useEffect, useMemo, forwardRef, type ReactNode, type ComponentProps } from 'react';

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
  /** Rows pinned under the list: only the list scrolls when the popup runs
   *  out of room, so an action below a long list stays in view. */
  footer?: ReactNode;
  /** Keeps radio semantics while allowing a consumer-specific selection cue. */
  selectionAppearance?: 'fill' | 'none';
  side?: MenuPositionerProps['side'];
  align?: MenuPositionerProps['align'];
  sideOffset?: number;
  /** Positions the menu against this element instead of its trigger, for a
   *  menu opened from inside a panel that should clear the whole panel. */
  anchor?: MenuPositionerProps['anchor'];
}

// Inside the popup, Base UI's Menu.Item / Menu.RadioItem own the role,
// aria-checked, tabIndex, roving highlight, typeahead, and Enter/Space/
// click activation (activation synthesizes a click, so the row div's
// onClick also fires for keyboard). The render div carries the Fluid
// Functionalism visuals and the proximity-hover registration.
function renderMenuItem({
  radio,
  toggle,
  value,
  disabled,
  closeOnClick,
  label,
  element,
  children: itemChildren,
}: MenuItemRenderOptions) {
  return toggle ? (
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
  );
}

/** One measured run of rows: the element that holds them, and the overlays
 *  and registration drawn inside it. The overlays sit in the rows' own
 *  coordinates and scroll with them, so rows that scroll and rows that stay
 *  put cannot share one: a pinned footer is a region of its own. */
function useMenuRegion(selectionAppearance: 'fill' | 'none') {
  const { open } = useDropdownMenuContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const surface = useMenuSurface(containerRef, { clearFocusRingOnPointerEnter: true });
  const { activeIndex, measureItems, registerItem, sessionRef } = surface;
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
  const contentCtx = useMemo(
    () => ({ registerItem, activeIndex, itemRegistry, renderMenuItem }),
    [registerItem, activeIndex, itemRegistry],
  );

  const rows = (children: ReactNode) => (
    <>
      <MenuSurfaceOverlays
        activeRect={activeRect ?? null}
        checkedRect={(selectionAppearance === 'fill' ? checkedRect : null) ?? null}
        focusRect={focusRect ?? null}
        hoverOrigin={checkedRect ?? null}
        hoverSession={sessionRef.current}
      />
      <DropdownContext.Provider value={contentCtx}>
        {/* display: contents keeps items direct flex children of the
            region so proximity measurement and gap layout still work,
            while the group provides the radio value context. */}
        <Menu.RadioGroup value={checkedIndex ?? null} className="contents">
          {children}
        </Menu.RadioGroup>
      </DropdownContext.Provider>
    </>
  );
  return { containerRef, rows, surfaceProps: surface.surfaceProps };
}

/** The rows pinned under a scrolling list, with a rule between the two. */
function DropdownFooter({
  children,
  selectionAppearance,
}: {
  children: ReactNode;
  selectionAppearance: 'fill' | 'none';
}) {
  const region = useMenuRegion(selectionAppearance);
  return (
    <div
      ref={region.containerRef}
      {...region.surfaceProps}
      className="relative flex shrink-0 flex-col gap-0.5 border-t border-border/60 p-1"
    >
      {region.rows(children)}
    </div>
  );
}

const DropdownContent = forwardRef<HTMLDivElement, DropdownContentProps>(
  (
    {
      className,
      children,
      footer,
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
    const list = useMenuRegion(selectionAppearance);
    const popupMotion = usePopupMotion({ open, fromBottomEdge: side === 'top' });
    // min-w tracks the anchor, the trigger unless the caller names another,
    // via the Positioner's --anchor-width var.
    const popupClassName = `relative flex max-h-[min(480px,var(--available-height))] w-72 max-w-full min-w-[var(--anchor-width)] flex-col ${shape.container} outline-none select-none`;

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
            {footer === undefined ? (
              <Menu.Popup
                render={
                  <Elevated offset={2} shadowLevel={3} ref={mergeRefs(list.containerRef, ref)} />
                }
                {...list.surfaceProps}
                {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
                className={cn(popupClassName, 'gap-0.5 overflow-y-auto p-1', className)}
              >
                {list.rows(children)}
              </Menu.Popup>
            ) : (
              <Menu.Popup
                render={<Elevated offset={2} shadowLevel={3} ref={ref} />}
                {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
                className={cn(popupClassName, 'overflow-hidden', className)}
              >
                <div
                  ref={list.containerRef}
                  {...list.surfaceProps}
                  className="relative flex min-h-0 flex-col gap-0.5 overflow-y-auto p-1"
                >
                  {list.rows(children)}
                </div>
                <DropdownFooter selectionAppearance={selectionAppearance}>{footer}</DropdownFooter>
              </Menu.Popup>
            )}
          </motion.div>
        </Menu.Positioner>
      </Menu.Portal>
    );
  },
);

DropdownContent.displayName = 'DropdownContent';

export { DropdownContent };
