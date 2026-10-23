/** A menu row: the <li> elements, the context a row publishes to the parts
 *  inside it, its registration with the surrounding menu scope, and the exact
 *  trailing gutter its button has to reserve.
 *
 *  Rows are the unit the scope measures and the unit the overlays travel
 *  between. Everything a row's button and its trailing controls need to agree
 *  on — is this row hovered, is it active, how much room do its actions and
 *  badge claim — lives on the context below, so a button never has to be told
 *  about its siblings. */

'use client';

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type LiHTMLAttributes,
  type RefObject,
} from 'react';

import { MenuScopeContext } from '@/components/ui/sidebar-menu-scope';
import { useMergedRef } from '@/lib/merge-refs';
import { useShape } from '@/lib/shape-context';
import { useSize } from '@/lib/size-context';
import { useIsoLayoutEffect } from '@/lib/use-iso-layout-effect';
import { cn } from '@/lib/utils';

interface MenuItemContextValue {
  rowRef: RefObject<HTMLLIElement | null>;
  /** Ref callback for the row's <li> — also replays the row's active flag
   *  to the scope, covering the windows where the ref is detached. */
  attachRow: (node: HTMLLIElement | null) => void;
  isHovered: boolean;
  isActiveRow: boolean;
  /** True inside SidebarMenuSubItem — actions center on the shorter row. */
  isSubRow: boolean;
  setActive: (active: boolean) => void;
  setButtonEl: (el: HTMLElement | null) => void;
  /** Trailing controls on this row, registered by the action parts. The
   *  button turns them into an exact padding-right reservation. */
  actionCount: number;
  actionsShowOnHover: boolean;
  setActions: (count: number, showOnHover: boolean) => void;
}

export const MenuItemContext = createContext<MenuItemContextValue | null>(null);

// ─── Trailing-gutter math ────────────────────────────────────────────────────
//
// The label reserves exactly the trailing run it has to clear, plus one gap
// — the same rule the section header's label follows, so a row's chevron and
// a section header's chevron each sit one 4px gap from their action run.
// The run is the row's actions: 24px apiece, 4px between.
const ROW_BASE_PAD = 8;
const ROW_SLOT = 24;
const ROW_GAP = 4;
/** Where the run's rightmost action sits, measured from the row's right edge:
 *  right-1.5, the axis every trailing control shares. */
const ROW_ACTION_INSET = 6;

function rowGutter(actionCount: number) {
  if (!actionCount) return ROW_BASE_PAD;
  const actionsWidth = actionCount * ROW_SLOT + (actionCount - 1) * ROW_GAP;
  return ROW_ACTION_INSET + actionsWidth + ROW_GAP;
}

/** The row's trailing reservation as the two CSS vars its button's padding
 *  rules read. At rest, hover-revealed actions claim no width (the label owns
 *  the row); once revealed the row widens to `--row-gutter-hover`. */
function rowGutterVars(item: MenuItemContextValue | null): CSSProperties {
  const gutterHover = rowGutter(item?.actionCount ?? 0);
  const gutterRest = item?.actionsShowOnHover ? rowGutter(0) : gutterHover;
  return {
    '--row-gutter': `${gutterRest}px`,
    '--row-gutter-hover': `${gutterHover}px`,
  } as CSSProperties;
}

interface RowButtonSurroundings {
  /** The row this button belongs to, or null outside a menu row. */
  item: MenuItemContextValue | null;
  /** The shape system's radius class for a row-sized box. */
  itemShape: string;
  /** True on the compact step of the size ladder, which shortens every row. */
  compact: boolean;
  /** The size ladder's leading-glyph size, in px. */
  iconSize: number;
  /** The size ladder's label class. */
  textClass: string;
  /** The row's trailing reservation, as the CSS vars its padding rules read. */
  gutterVars: CSSProperties;
}

/** Everything a row button needs from its surroundings, and the registration
 *  it owes them.
 *
 *  Calling it publishes the button element and its active flag to the row,
 *  which forwards both to the menu scope — the scope measures the button, not
 *  the <li>, and the active flag is what lights the row's background. Shared
 *  by the parent rows' button and the sub rows' button, which differ only in
 *  their element, their height ladder and their tab-stop rule. */
export function useRowButton<T extends HTMLElement>(
  buttonRef: RefObject<T | null>,
  active: boolean,
): RowButtonSurroundings {
  const item = useContext(MenuItemContext);
  const shape = useShape();
  const sizeClasses = useSize();

  const setActive = item?.setActive;
  useIsoLayoutEffect(() => {
    setActive?.(active);
    return () => setActive?.(false);
  }, [active, setActive]);

  const setButtonEl = item?.setButtonEl;
  useIsoLayoutEffect(() => {
    setButtonEl?.(buttonRef.current);
    return () => setButtonEl?.(null);
  }, [buttonRef, setButtonEl]);

  return {
    item,
    itemShape: shape.item,
    compact: sizeClasses.variant === 'compact',
    iconSize: sizeClasses.icon,
    textClass: sizeClasses.text,
    gutterVars: rowGutterVars(item),
  };
}

function useMenuRow(rowRef: RefObject<HTMLLIElement | null>, isSubRow = false) {
  const scope = useContext(MenuScopeContext);
  const registerRow = scope?.registerRow;
  const setRowButton = scope?.setRowButton;
  const setRowActive = scope?.setRowActive;

  // The button's setActive effect can fire while this row's <li> ref is
  // detached: a child's layout effects run before its parent's ref attaches
  // — at mount, and on EVERY re-render whose inline ref identity changes
  // (React detaches the old callback, nulling the ref, before the layout
  // phase). The flag holds the truth through that window, and attachRow
  // re-syncs the scope whenever the <li> lands.
  const activeFlagRef = useRef(false);

  useIsoLayoutEffect(() => {
    const el = rowRef.current;
    if (!el || !registerRow) return;
    return registerRow(el);
  }, [registerRow, rowRef]);

  /** The <li>'s ref callback: tracks the element and replays the active flag
   *  the scope may have missed while the ref was detached. */
  const attachRow = useCallback(
    (node: HTMLLIElement | null) => {
      rowRef.current = node;
      if (node && setRowActive) setRowActive(node, activeFlagRef.current);
    },
    [setRowActive, rowRef],
  );

  const setActive = useCallback(
    (active: boolean) => {
      activeFlagRef.current = active;
      if (rowRef.current && setRowActive) setRowActive(rowRef.current, active);
    },
    [setRowActive, rowRef],
  );

  const setButtonEl = useCallback(
    (el: HTMLElement | null) => {
      if (rowRef.current && setRowButton) setRowButton(rowRef.current, el);
    },
    [setRowButton, rowRef],
  );

  const isHovered = rowRef.current !== null && scope?.hoveredRowEl === rowRef.current;
  const isActiveRow =
    rowRef.current !== null && (scope?.activeRows.includes(rowRef.current) ?? false);

  const [trailing, setTrailing] = useState({ actionCount: 0, actionsShowOnHover: false });
  const setActions = useCallback(
    (count: number, showOnHover: boolean) =>
      setTrailing((prev) =>
        prev.actionCount === count && prev.actionsShowOnHover === showOnHover
          ? prev
          : { actionCount: count, actionsShowOnHover: showOnHover },
      ),
    [],
  );

  return useMemo(
    () => ({
      rowRef,
      attachRow,
      isHovered,
      isActiveRow,
      isSubRow,
      setActive,
      setButtonEl,
      ...trailing,
      setActions,
    }),
    [
      rowRef,
      attachRow,
      isHovered,
      isActiveRow,
      isSubRow,
      setActive,
      setButtonEl,
      trailing,
      setActions,
    ],
  );
}

type SidebarMenuItemProps = LiHTMLAttributes<HTMLLIElement>;

/** The row both menu levels are: an <li> that owns the row state its button,
 *  actions and sub-rows read. Only the level differs, and the level decides
 *  the hover-scope class and the attribute the menu's own queries select on. */
const MenuRow = forwardRef<HTMLLIElement, SidebarMenuItemProps & { sub: boolean }>(
  ({ className, children, sub, ...props }, ref) => {
    const rowRef = useRef<HTMLLIElement>(null);
    const item = useMenuRow(rowRef, sub);
    const { attachRow } = item;
    // Stable ref callback: an inline one is detached and re-attached around
    // every re-render, and child layout effects fire inside that null window.
    const refCb = useMergedRef<HTMLLIElement>(attachRow, ref);
    return (
      <MenuItemContext.Provider value={item}>
        <li
          ref={refCb}
          data-sidebar={sub ? 'menu-sub-item' : 'menu-item'}
          className={cn(sub ? 'group/menu-sub-item' : 'group/menu-item', 'relative', className)}
          {...props}
        >
          {children}
        </li>
      </MenuItemContext.Provider>
    );
  },
);
MenuRow.displayName = 'MenuRow';

const SidebarMenuItem = forwardRef<HTMLLIElement, SidebarMenuItemProps>((props, ref) => (
  <MenuRow {...props} ref={ref} sub={false} />
));
SidebarMenuItem.displayName = 'SidebarMenuItem';

const SidebarMenuSubItem = forwardRef<HTMLLIElement, SidebarMenuItemProps>((props, ref) => (
  <MenuRow {...props} ref={ref} sub />
));
SidebarMenuSubItem.displayName = 'SidebarMenuSubItem';

export { SidebarMenuItem, SidebarMenuSubItem };
