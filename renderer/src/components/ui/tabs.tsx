/** The value-driven tab strip: standalone pills on whatever substrate they
 *  land on, with no track drawn around them. The selected tab wears the hover
 *  tint, the one gray hovered and selected share, so light and dark show the
 *  same flat lift. It wraps Base UI's Tabs primitive, which owns role/tabindex and
 *  arrow-key navigation, and adds the Fluid layer — an optimistic pill jump on
 *  click and the ladder-aligned sizing. The measured indicator layers and the
 *  tab label live in `components/internal/tabs-strip`, shared with the
 *  borderless `tabs-subtle` variant.
 *
 *  A tab is identified by its `value` and by nothing else. The list used to
 *  read its children twice over — once to collect their `value` props into an
 *  order, once to `cloneElement` a private `_index` into each — which meant a
 *  tab behind a wrapper component had to forward an underscore-prefixed prop
 *  it never asked for, and a tab that was not a direct child got no index at
 *  all. Tabs now register their element with the shared DOM-order registry
 *  (`@/lib/use-dom-order-registry`) and read their own position back. */

'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  createContext,
  useContext,
  forwardRef,
  type ComponentPropsWithoutRef,
} from 'react';

import { useProximityRow } from '@/components/internal/proximity-row';
import {
  TabsStripIndicators,
  TabsStripLabel,
  useTabsStrip,
} from '@/components/internal/tabs-strip';
import type { IconComponent } from '@/lib/icon-context';
import { useShape } from '@/lib/shape-context';
import { SizeProvider, useSize, type SizeVariant } from '@/lib/size-context';
import {
  useDomOrderRegistry,
  useMarkedIndex,
  type DomOrderRegistry,
} from '@/lib/use-dom-order-registry';
import { cn } from '@/lib/utils';

/* ─────────────────────── Contexts ─────────────────────── */

interface TabsRootContextValue {
  selectedValue: string | undefined;
  /** The first tab reports its value, which is what an uncontrolled Tabs with
   *  no `defaultValue` falls back to. Reported rather than counted, so the
   *  root never inspects its own descendants. */
  reportFirstValue: (value: string) => void;
}

const TabsRootContext = createContext<TabsRootContextValue | null>(null);

interface TabsListContextValue {
  registry: DomOrderRegistry;
  registerItem: (index: number, el: HTMLElement | null) => void;
  hoveredIndex: number | null;
  selectedValue: string | undefined;
  reportFirstValue: (value: string) => void;
  setOptimisticIdx: (index: number) => void;
}

const TabsListContext = createContext<TabsListContextValue | null>(null);

function useTabsList() {
  const ctx = useContext(TabsListContext);
  if (!ctx) throw new Error('TabItem must be used within a TabsList');
  return ctx;
}

/* ─────────────────────── Tabs (Root) ─────────────────────── */

interface TabsProps extends Omit<
  ComponentPropsWithoutRef<typeof TabsPrimitive.Root>,
  'onValueChange' | 'value' | 'defaultValue' | 'onSelect'
> {
  /** The selected tab's value. Pass it with `onValueChange` for a controlled
   *  compound; leave both off and the tabs manage themselves. */
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  /** Pins the segmented control to one step of the size ladder (default 36px
   *  outer, compact 28px — see /docs/sizes). Omitted, it follows the
   *  surrounding SizeProvider. */
  size?: SizeVariant;
}

const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  ({ value, onValueChange, defaultValue, size, children, ...props }, ref) => {
    const [uncontrolledValue, setUncontrolledValue] = useState<string | undefined>(defaultValue);
    const [firstValue, setFirstValue] = useState<string | undefined>(undefined);

    // Uncontrolled with no defaultValue falls back to the first tab, so the
    // Fluid layer's selectedValue matches what the primitive shows.
    const resolvedValue = value ?? uncontrolledValue ?? firstValue;

    // Base UI passes (value, eventDetails); we only need value.
    const handleValueChange = useCallback(
      (newValue: unknown) => {
        const next = newValue as string;
        if (value === undefined) setUncontrolledValue(next);
        onValueChange?.(next);
      },
      [onValueChange, value],
    );

    const rootCtx = useMemo(
      () => ({ selectedValue: resolvedValue, reportFirstValue: setFirstValue }),
      [resolvedValue],
    );

    const root = (
      <TabsRootContext.Provider value={rootCtx}>
        {/*
          Always controlled: Base UI's useControlled logs a dev warning when
          value flips undefined → defined. No tab has reported in on the first
          commit, so fall back to an empty-string sentinel — registration runs
          in a layout effect, so the corrected value lands before anything is
          visible.
        */}
        <TabsPrimitive.Root
          ref={ref}
          value={resolvedValue ?? ''}
          onValueChange={handleValueChange}
          {...props}
        >
          {children}
        </TabsPrimitive.Root>
      </TabsRootContext.Provider>
    );

    // A size prop pins the whole compound (list + items) to one ladder step.
    return size ? <SizeProvider size={size}>{root}</SizeProvider> : root;
  },
);

Tabs.displayName = 'Tabs';

/* ─────────────────────── TabsList ─────────────────────── */

type TabsListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List>;

const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ children, className, ...props }, ref) => {
    const shape = useShape();
    const sizeClasses = useSize();
    const rootCtx = useContext(TabsRootContext);
    const [optimisticIdx, setOptimisticIdx] = useState<number | null>(null);

    const registry = useDomOrderRegistry();
    // The selected tab marks itself, so the pill's resting place comes from
    // the tabs rather than from the list counting them.
    const markedIndex = useMarkedIndex(registry);
    const selectedIdx = markedIndex ?? -1;

    const strip = useTabsStrip('[role="tab"]', ref);
    const { hoveredIndex, registerItem, measureItems } = strip;

    // Registration and the proximity hook's resize observer keep the rects
    // current; a measure per render would force layout on every parent update.
    useEffect(() => {
      measureItems();
    }, [measureItems]);

    useEffect(() => {
      setOptimisticIdx(selectedIdx >= 0 ? selectedIdx : null);
    }, [selectedIdx]);

    const selectedValue = rootCtx?.selectedValue;
    const reportFirstValue = rootCtx?.reportFirstValue;
    const listCtx = useMemo(
      () => ({
        registry,
        registerItem,
        hoveredIndex,
        selectedValue,
        reportFirstValue: reportFirstValue ?? (() => undefined),
        setOptimisticIdx,
      }),
      [registry, registerItem, hoveredIndex, selectedValue, reportFirstValue],
    );

    return (
      <TabsListContext.Provider value={listCtx}>
        <TabsPrimitive.List
          // Match Radix's `activationMode="automatic"` — arrow keys move + activate.
          activateOnFocus
          ref={strip.listRef}
          {...strip.listHandlers}
          className={cn(
            // segmentPad + segmentItem add up to the ladder's control height
            // (36px default, 28px compact) so the strip's outer box lines up
            // with buttons, selects, and inputs beside it. No background: the
            // strip draws no track, only its pills.
            'relative inline-flex items-center gap-0.5 select-none',
            sizeClasses.segmentPad,
            shape.container,
            className,
          )}
          {...props}
        >
          {/* Borderless pills: the selection and the hover preview wear the
              one tint, and the selection holds still while another tab is
              hovered. A surface-ladder lift would vanish in light, where the
              ladder has nothing whiter than the paper the strip sits on. */}
          <TabsStripIndicators
            strip={strip}
            selectedIndex={optimisticIdx}
            selectedSurface="bg-hover"
            selectedHoverOpacity={1}
            hoverSurface="bg-hover"
          />

          {children}
        </TabsPrimitive.List>
      </TabsListContext.Provider>
    );
  },
);

TabsList.displayName = 'TabsList';

/* ─────────────────────── TabItem ─────────────────────── */

interface TabItemProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Tab> {
  value: string;
  icon?: IconComponent;
  label: string;
  /** Optional presentational action glyph. Keep the tab as the sole semantic
   *  control and provide its keyboard equivalent on the tab itself. */
  trailingIcon?: IconComponent;
  onTrailingClick?: () => void;
}

const TabItem = forwardRef<HTMLButtonElement, TabItemProps>(
  (
    {
      value,
      icon: Icon,
      label,
      trailingIcon: TrailingIcon,
      onTrailingClick,
      className,
      onClick,
      ...props
    },
    ref,
  ) => {
    const sizeClasses = useSize();
    const {
      registry,
      registerItem,
      hoveredIndex,
      selectedValue,
      reportFirstValue,
      setOptimisticIdx,
    } = useTabsList();

    const isSelected = selectedValue === value;
    // Registering publishes both the tab's position and whether it is the
    // selected one, which is everything the strip needs from it.
    const {
      index,
      isActive: isHovered,
      ref: tabRef,
    } = useProximityRow<HTMLButtonElement>(
      ref,
      { activeIndex: hoveredIndex, registerItem, registry },
      isSelected,
    );

    useEffect(() => {
      if (index === 0) reportFirstValue(value);
    }, [index, reportFirstValue, value]);

    const isActive = isHovered || isSelected;

    return (
      <TabsPrimitive.Tab
        // Composed (not spread-overridable): a consumer onClick must not
        // replace the optimistic indicator jump.
        onClick={(e) => {
          if ((e.target as Element).closest('[data-tab-trailing]')) {
            onTrailingClick?.();
            return;
          }
          setOptimisticIdx(index);
          onClick?.(e);
        }}
        ref={tabRef}
        value={value}
        data-proximity-index={index}
        className={cn(
          // Fixed height (not py) so the text-box trim below doesn't shrink
          // the tab — browsers without text-box support render identically.
          'relative z-10 flex cursor-pointer items-center border-none bg-transparent px-3 outline-none',
          sizeClasses.segmentItem,
          sizeClasses.gap,
          className,
        )}
        {...props}
      >
        {Icon && (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={isActive ? 2 : 1.5}
            className={cn(
              'transition-[color,stroke-width] duration-fast',
              isActive ? 'text-foreground' : 'text-muted-foreground',
            )}
          />
        )}
        <TabsStripLabel label={label} isActive={isActive} />
        {/* The close glyph rests muted and turns to ink under its own pointer,
         *  at the same stroke, and stands in ink on the selected tab: a
         *  glyph darkens when it is the thing hovered, not when its row is,
         *  the rule the sidebar's rows keep, and it never thickens. */}
        {TrailingIcon && (
          <span
            aria-hidden="true"
            className={cn(
              'flex size-4 items-center justify-center transition-colors duration-fast',
              isSelected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            data-tab-trailing=""
          >
            <TrailingIcon size={12} strokeWidth={1.5} />
          </span>
        )}
      </TabsPrimitive.Tab>
    );
  },
);

TabItem.displayName = 'TabItem';

/* ─────────────────────── TabPanel ─────────────────────── */

interface TabPanelProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Panel> {
  value: string;
}

const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(({ className, ...props }, ref) => {
  return <TabsPrimitive.Panel ref={ref} className={cn('outline-none', className)} {...props} />;
});

TabPanel.displayName = 'TabPanel';

export { Tabs, TabsList, TabItem, TabPanel };
