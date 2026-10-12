/** The borderless tab strip: standalone pills on whatever substrate they land
 *  on, with no track drawn around them. It wraps Base UI's Tabs primitive for
 *  role/tabindex and arrow-key navigation, and drives selection by index rather
 *  than value, so a caller holding a numeric tab index needs no translation.
 *  Tabs take no `index`: each registers its element with the shared DOM-order
 *  registry and reads its own position back, so a conditional tab renumbers
 *  nothing. Its distinctive part is the collapsing label — `activeLabel` shows
 *  text on the selected tab only, `iconOnly` on none — which animates to a
 *  measured layout width. The measured indicator layers and the label itself
 *  live in `components/internal/tabs-strip`, shared with the segmented `tabs`
 *  variant. */

'use client';

import { Tabs } from '@base-ui/react/tabs';
import {
  useEffect,
  useMemo,
  createContext,
  useContext,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
  type ButtonHTMLAttributes,
} from 'react';

import { useProximityRow } from '@/components/internal/proximity-row';
import {
  TabsStripCollapsingLabel,
  TabsStripIndicators,
  TabsStripLabel,
  useTabsStrip,
} from '@/components/internal/tabs-strip';
import type { IconComponent } from '@/lib/icon-context';
import { useShape } from '@/lib/shape-context';
import { SizeProvider, useSize, type SizeVariant } from '@/lib/size-context';
import { surfaceBackground } from '@/lib/surface-classes';
import { useSurface } from '@/lib/surface-context';
import { useDomOrderRegistry, type DomOrderRegistry } from '@/lib/use-dom-order-registry';
import { cn } from '@/lib/utils';

interface TabsSubtleContextValue {
  registry: DomOrderRegistry;
  registerTab: (index: number, element: HTMLElement | null) => void;
  hoveredIndex: number | null;
  selectedIndex: number;
  idPrefix: string | undefined;
  activeLabel: boolean;
  iconOnly: boolean;
  track: boolean;
}

const TabsSubtleContext = createContext<TabsSubtleContextValue | null>(null);

function useTabsSubtle() {
  const ctx = useContext(TabsSubtleContext);
  if (!ctx) throw new Error('useTabsSubtle must be used within a TabsSubtle');
  return ctx;
}

interface TabsSubtleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  children: ReactNode;
  selectedIndex: number;
  onSelect: (index: number) => void;
  idPrefix?: string;
  /** When true, only the selected tab shows its text label. Requires icons on tabs. */
  activeLabel?: boolean;
  /** When true, labels remain available to assistive technology but only icons are visible. */
  iconOnly?: boolean;
  /** Pins the tabs to one step of the size ladder (default 36px, compact
   *  28px — see /docs/sizes). Omitted, they follow the surrounding
   *  SizeProvider. */
  size?: SizeVariant;
  /** Draws the strip as a segmented control: one muted track with the
   *  selected tab as a lifted pill (the surface three steps up, no shadow,
   *  the same lift the preset picker uses) that glides between the tabs.
   *  Track and items add up to the ladder's control height, so the control
   *  lines up with the buttons beside it. */
  track?: boolean;
}

const TabsSubtle = forwardRef<HTMLDivElement, TabsSubtleProps>(
  (
    {
      children,
      selectedIndex,
      onSelect,
      idPrefix,
      activeLabel = false,
      iconOnly = false,
      size,
      track = false,
      className,
      ...props
    },
    ref,
  ) => {
    const shape = useShape();
    // The pinned size, when there is one: the provider below wraps only the
    // children, so the track drawn here would otherwise read the ambient
    // step and sit two pixels wider than the items inside it.
    const sizeClasses = useSize(size);
    const lifted = surfaceBackground(Math.min(useSurface() + 3, 8));
    const strip = useTabsStrip('[data-proximity-index]', ref);
    const { hoveredIndex, registerItem, measureItems: measureTabs } = strip;
    const registry = useDomOrderRegistry();

    const registerTab = registerItem;

    // Registration remeasures a changed tab set and the proximity hook observes
    // each tab's size, so only the first layout is measured here. Measuring on
    // every render forced a synchronous layout of whatever changed around the
    // strip, which beside a long document was the whole document.
    useEffect(() => {
      measureTabs();
    }, [measureTabs]);

    const tabsCtx = useMemo(
      () => ({
        registry,
        registerTab,
        hoveredIndex,
        selectedIndex,
        idPrefix,
        activeLabel,
        iconOnly,
        track,
      }),
      [registry, registerTab, hoveredIndex, selectedIndex, idPrefix, activeLabel, iconOnly, track],
    );

    const root = (
      <TabsSubtleContext.Provider value={tabsCtx}>
        {/* Root is merged into List via `render` so a single <div> is emitted,
            matching the previous DOM structure. Base UI owns role="tablist",
            roving tabindex, and Arrow/Home/End keyboard navigation.
            `activateOnFocus={false}` keeps manual activation: arrows move
            focus, Enter/Space selects. */}
        <Tabs.Root
          value={selectedIndex}
          onValueChange={(value) => {
            if (typeof value === 'number') onSelect(value);
          }}
          render={
            <Tabs.List
              activateOnFocus={false}
              ref={strip.listRef}
              {...strip.listHandlers}
              className={cn(
                track
                  ? // The track: segmentPad + segmentItem add up to the
                    // ladder's control height, and the muted bar is what the
                    // lifted pill reads against.
                    cn(
                      'relative inline-flex items-center gap-0.5 bg-muted select-none',
                      shape.container,
                      sizeClasses.segmentPad,
                    )
                  : // -mx-1 px-1 / -my-1 py-1 give the 2px-outset focus ring room
                    // to draw without being clipped by overflow-x-auto. The
                    // max-width allows for the negative margins: fit-content
                    // parents size against the margin box (8px narrower than the
                    // border box), so a plain max-w-full would clamp the list 8px
                    // too small and clip the first/last tab's ring.
                    'scrollbar-hide relative -mx-1 -my-1 flex max-w-[calc(100%_+_8px)] items-center gap-0.5 overflow-x-auto px-1 py-1 select-none',
                className,
              )}
              {...props}
            >
              {/* Borderless pills: the selection and the hover preview wear
                  the one tint, and the selection holds still while another
                  tab is hovered. On a track the selection is the lifted
                  pill instead, gliding between the tabs. */}
              <TabsStripIndicators
                strip={strip}
                selectedIndex={selectedIndex}
                selectedSurface={track ? lifted : 'bg-hover'}
                {...(track ? { radius: sizeClasses.segmentRadius } : {})}
                selectedHoverOpacity={1}
                hoverSurface="bg-hover"
              />

              {children}
            </Tabs.List>
          }
        />
      </TabsSubtleContext.Provider>
    );

    // A size prop pins every tab to one ladder step.
    return size ? <SizeProvider size={size}>{root}</SizeProvider> : root;
  },
);

TabsSubtle.displayName = 'TabsSubtle';

interface TabsSubtleItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconComponent;
  label: string;
}

const TabsSubtleItem = forwardRef<HTMLButtonElement, TabsSubtleItemProps>(
  ({ icon: Icon, label, className, ...props }, ref) => {
    const shape = useShape();
    const sizeClasses = useSize();
    const {
      registry,
      registerTab,
      hoveredIndex,
      selectedIndex,
      idPrefix,
      activeLabel,
      iconOnly,
      track,
    } = useTabsSubtle();

    // The tab's position is where it sits, not a number its caller counted
    // out; this strip resolves its selection by index, so no tab marks itself.
    const {
      index,
      isActive: isHovered,
      ref: tabRef,
    } = useProximityRow<HTMLButtonElement>(
      ref,
      { activeIndex: hoveredIndex, registerItem: registerTab, registry },
      false,
    );
    const isSelected = selectedIndex === index;

    const isActive = isHovered || isSelected;
    const collapseLabel = (activeLabel || iconOnly) && !!Icon;
    const showLabel = !collapseLabel || (!iconOnly && isSelected);

    return (
      // Base UI Tab renders a native <button type="button"> and wires
      // role="tab", aria-selected, roving tabindex, and activation for us.
      // id/aria-controls are only overridden when an idPrefix is supplied so
      // externally rendered TabsSubtlePanel elements stay linked.
      <Tabs.Tab
        ref={tabRef}
        value={index}
        data-proximity-index={index}
        id={idPrefix ? `${idPrefix}-tab-${index}` : undefined}
        aria-controls={idPrefix ? `${idPrefix}-panel-${index}` : undefined}
        aria-label={collapseLabel && !showLabel ? label : undefined}
        className={cn(
          // Fixed heights (was py-2 around a 19.5px line box ≈ 35.5px) so the
          // text-box trim on the label doesn't shrink the tab. Standalone
          // pills sit directly on the ladder's control height.
          'relative z-10 flex cursor-pointer items-center border-none bg-transparent outline-none',
          // A glyph-only item is the ladder's square, the same box every
          // icon button beside it wears, so its pill matches theirs; a
          // labelled item takes the control height and its own padding.
          // On a track the items take the segment height instead, a
          // glyph-only one a step wider than tall so the pill reads as a
          // pill and not a square.
          iconOnly && Icon
            ? track
              ? cn(sizeClasses.segmentItem, sizeClasses.segmentGlyphWidth, 'justify-center')
              : cn(sizeClasses.square, 'justify-center')
            : cn(track ? sizeClasses.segmentItem : sizeClasses.control, sizeClasses.px),
          !collapseLabel && sizeClasses.gap,
          track ? sizeClasses.segmentRadius : shape.bg,
          className,
        )}
        {...props}
      >
        {Icon && (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={isActive ? 2 : 1.5}
            className={cn(
              'shrink-0 transition-[color,stroke-width] duration-fast',
              isActive ? 'text-foreground' : 'text-muted-foreground',
            )}
          />
        )}
        {collapseLabel ? (
          <TabsStripCollapsingLabel isActive={isActive} label={label} show={showLabel} />
        ) : (
          <TabsStripLabel label={label} isActive={isActive} />
        )}
      </Tabs.Tab>
    );
  },
);

TabsSubtleItem.displayName = 'TabsSubtleItem';

interface TabsSubtlePanelProps extends HTMLAttributes<HTMLDivElement> {
  index: number;
  selectedIndex: number;
  idPrefix: string;
  children: ReactNode;
}

// The three props stay, and the reason is structural rather than stylistic.
// A panel is rendered outside <TabsSubtle> — it belongs to the surrounding
// layout, not to the strip — so it cannot use Base UI's Tabs.Panel (which
// requires the Tabs.Root context) and cannot read the strip's registry either.
// Deriving `index` from a context would need a panel HOST to hang that context
// on, and the one product surface that renders panels (the sidebar navigator)
// puts them in two different regions of its own layout, which is precisely the
// arrangement a host cannot bracket. So `index` is the caller's own tab number
// — the same one it already passes to `selectedIndex` — and `idPrefix` is the
// only thread that links a panel to a tab across that gap. A plain tabpanel,
// wired by id.
//
// Known gap: `features/retrieval/ui/search/tab-strip` passes `idPrefix` while
// rendering no panel at all, so every tab there points `aria-controls` at an
// element that does not exist. The fix is at that call site — drop `idPrefix`,
// or render the panels — not here.
const TabsSubtlePanel = forwardRef<HTMLDivElement, TabsSubtlePanelProps>(
  ({ index, selectedIndex, idPrefix, children, className, ...props }, ref) => {
    const isSelected = selectedIndex === index;

    return (
      <div
        ref={ref}
        id={`${idPrefix}-panel-${index}`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${index}`}
        hidden={!isSelected}
        tabIndex={-1}
        className={cn('outline-none', className)}
        {...props}
      >
        {isSelected && children}
      </div>
    );
  },
);

TabsSubtlePanel.displayName = 'TabsSubtlePanel';

export { TabsSubtle, TabsSubtleItem, TabsSubtlePanel };
