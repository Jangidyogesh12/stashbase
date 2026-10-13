/**
 * The context every menu surface shares with its rows.
 *
 * It lives here rather than in the dropdown module so that (a) MenuItem stays
 * primitive-free and self-contained, and (b) surfaces built on different
 * primitives (Radix, Base UI) can render side by side — each provides this
 * same context object, so MenuItem resolves whichever provider actually wraps
 * it.
 *
 * Neither the row's position nor the surface's checked row is passed in. Rows
 * register their element with the shared DOM-order registry on this context
 * (`lib/use-dom-order-registry`), which answers both questions from where the
 * rows actually sit — so a list that inserts a row in the middle renumbers
 * nothing, and a surface never has to be told which row it just checked.
 */
'use client';

import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import type { DomOrderRegistry } from '@/lib/use-dom-order-registry';

/** What MenuItem hands to the popup's primitive wrapper. `element` is the
 *  styled row div (visuals + proximity registration, no children); `children`
 *  is the row content (icon, label, trailing action, check). The dropdown wraps them in its
 *  own Item / RadioItem primitive, so MenuItem itself stays primitive-free. */
export interface MenuItemRenderOptions {
  /** Radio-style option (boolean `checked` on MenuItem) vs plain action item. */
  radio: boolean;
  /** A toggle row (boolean `switched` on MenuItem), and whether it is on. A
   *  row is a radio or a toggle, never both. */
  toggle?: { readonly on: boolean } | undefined;
  /** The item's index — doubles as the radio value. */
  value: number;
  disabled?: boolean | undefined;
  /** Whether activating the row closes the surface; undefined takes the
   *  primitive's default. A row that swaps the surface's own content passes
   *  false. */
  closeOnClick?: boolean | undefined;
  label: string;
  element: ReactElement;
  children: ReactNode;
}

interface DropdownContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
  /** The surface's row registry, which derives every row's index from the
   *  order its element appears in the DOM. */
  itemRegistry: DomOrderRegistry;
  /** Wraps a MenuItem's styled div in the surface's menu-item primitive.
   *  Required: a row outside a surface that supplies one would have to own the
   *  whole menu keyboard pattern itself, which is exactly the branch that was
   *  deleted along with the inline panel. */
  renderMenuItem: (opts: MenuItemRenderOptions) => ReactElement;
}

export const DropdownContext = createContext<DropdownContextValue | null>(null);

export function useDropdown(): DropdownContextValue {
  const ctx = useContext(DropdownContext);
  if (!ctx) throw new Error('useDropdown must be used within a Dropdown');
  return ctx;
}
