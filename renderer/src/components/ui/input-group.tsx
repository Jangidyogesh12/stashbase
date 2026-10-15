/** A labelled field: the label, the control, the helper/error line, and the
 *  border that reacts to focus and validity. `InputGroup` owns the field
 *  semantics (id wiring, `aria-describedby`, invalid state) and `InputField`
 *  owns the bordered box, so a consumer can put a native input, a textarea, or
 *  a custom control inside the same chrome without re-deriving the a11y ids. */

'use client';

import { Field } from '@base-ui/react/field';
import {
  useRef,
  useState,
  useEffect,
  useMemo,
  createContext,
  useContext,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
  type InputHTMLAttributes,
} from 'react';

import { useProximityRow, type ProximityRowSurface } from '@/components/internal/proximity-row';
import { FOCUS_RING_TINT } from '@/lib/focus-ring';
import { fontWeights } from '@/lib/font-weight';
import type { IconComponent } from '@/lib/icon-context';
import { mergeRefs } from '@/lib/merge-refs';
import { useShape } from '@/lib/shape-context';
import { SizeProvider, useSize, type SizeVariant } from '@/lib/size-context';
import { useDomOrderRegistry } from '@/lib/use-dom-order-registry';
import { useProximityHover } from '@/lib/use-proximity-hover';
import { cn } from '@/lib/utils';

// A field's position is its position in the document, so the group publishes
// the registry the fields put their own elements into rather than a number
// each caller has to count out. Inserting a field in the middle of a form
// renumbers nothing.
type InputGroupContextValue = ProximityRowSurface;

const InputGroupContext = createContext<InputGroupContextValue | null>(null);

function useInputGroup() {
  const ctx = useContext(InputGroupContext);
  if (!ctx) throw new Error('useInputGroup must be used within an InputGroup');
  return ctx;
}

interface InputGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Pins the group's fields to one step of the size ladder (default 36px,
   *  compact 28px — see /docs/sizes). Omitted, they follow the surrounding
   *  SizeProvider. */
  size?: SizeVariant;
}

const InputGroup = forwardRef<HTMLDivElement, InputGroupProps>(
  ({ children, size, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const { activeIndex, handlers, registerItem, measureItems } = useProximityHover(containerRef);
    const registry = useDomOrderRegistry();

    useEffect(() => {
      measureItems();
    }, [measureItems, children]);

    const contextValue = useMemo<InputGroupContextValue>(
      () => ({ registerItem, activeIndex, registry }),
      [registerItem, activeIndex, registry],
    );

    const group = (
      <InputGroupContext.Provider value={contextValue}>
        <div
          ref={mergeRefs(containerRef, ref)}
          onMouseEnter={handlers.onMouseEnter}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
          // `relative` makes this div the fields' offsetParent — the proximity
          // hook measures items via offsetTop and compares against
          // container-relative mouse coords, so the two coordinate spaces must
          // share this origin (same as every other proximity consumer).
          className={cn('relative flex w-72 max-w-full flex-col gap-3', className)}
          {...props}
        >
          {children}
        </div>
      </InputGroupContext.Provider>
    );

    // A size prop pins every field in the group to one ladder step.
    return size ? <SizeProvider size={size}>{group}</SizeProvider> : group;
  },
);

InputGroup.displayName = 'InputGroup';

interface InputFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string;
  /** Keep the label for assistive tech but don't render it — for inline
   *  fields (a toolbar search) where the placeholder carries the meaning. */
  labelHidden?: boolean;
  placeholder?: string;
  icon?: IconComponent;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  disabled?: boolean | undefined;
  /** What the field's box looks like when nothing is near it and nothing is
   *  focused.
   *
   *  `ghost` (the default) draws no box until the pointer reaches the field:
   *  the stacked-form case the proximity reveal exists for, where a box per
   *  row would be noise. `filled` is a quiet tint at rest, for a field
   *  standing alone inside a settings row where the reveal reads as plain
   *  text. `outline` keeps the hairline drawn at all times and lets the
   *  pointer change nothing at all — the standing search field a panel is
   *  built around, where a box that materialises under the pointer reads as
   *  a glitch rather than an affordance. */
  resting?: InputFieldResting;
  /** A control the box carries at its trailing edge: the clear or close of a
   *  field that is its own row. Inside the border rather than beside it, so
   *  the field fills the row instead of sharing it. Mirrors `icon`. */
  action?: ReactNode;
  className?: string;
}

type InputFieldResting = 'ghost' | 'filled' | 'outline';

const InputField = forwardRef<HTMLDivElement, InputFieldProps>(
  (
    {
      label,
      labelHidden,
      placeholder,
      icon: Icon,
      value,
      onChange,
      error,
      disabled,
      resting = 'ghost',
      action,
      className,
      ...props
    },
    ref,
  ) => {
    const inputRef = useRef<HTMLElement | null>(null);
    // The row hook registers the field's element, reads its index back out of
    // the group's registry, and publishes the element for the hover overlay
    // to measure — the three steps a proximity row cannot skip.
    const { isActive, ref: rowRef } = useProximityRow<HTMLDivElement>(ref, useInputGroup(), false);
    const [isFocused, setIsFocused] = useState(false);
    const shape = useShape();
    const sizeClasses = useSize();
    const compact = sizeClasses.variant === 'compact';

    const outlined = resting === 'outline';
    // An outlined field's box is already drawn, so the glyph inside it holds
    // still while the pointer passes: only focus lights it, and it is tinted
    // rather than also thickened, so one event moves one thing.
    const glyphLit = outlined ? isFocused : isActive || isFocused;

    const handleFocus = () => {
      setIsFocused(true);
    };

    const handleBlur = () => {
      setIsFocused(false);
    };

    // Input container classes
    let bgClass: string;
    let ringClass: string;

    if (disabled) {
      bgClass = resting === 'filled' ? 'bg-hover' : 'bg-transparent';
      ringClass = 'ring-border';
    } else if (resting === 'filled') {
      bgClass = isActive && !isFocused ? 'bg-active' : 'bg-hover';
      ringClass = error ? 'ring-destructive/50' : isFocused ? FOCUS_RING_TINT : 'ring-transparent';
    } else if (outlined) {
      // Rest and hover are the same box on the surface's own paper, so the
      // pointer crossing the field changes nothing. Focus fills it to the
      // card and leaves the hairline alone: the field this variant is for is
      // focused the moment its panel opens and holds focus the whole time it
      // is read, so a tinted ring would be standing colour rather than an
      // event, and the caret already says where the typing goes.
      bgClass = isFocused ? 'bg-card' : 'bg-transparent';
      ringClass = error ? 'ring-destructive/50' : 'ring-border';
    } else if (error) {
      bgClass = isFocused ? 'bg-card' : isActive ? 'bg-destructive-light/60' : 'bg-transparent';
      ringClass = isFocused || isActive ? 'ring-destructive/50' : 'ring-transparent';
    } else if (isFocused) {
      bgClass = 'bg-card';
      ringClass = 'ring-border';
    } else if (isActive) {
      bgClass = 'bg-muted/50';
      ringClass = 'ring-border';
    } else {
      bgClass = 'bg-transparent';
      ringClass = 'ring-transparent';
    }

    return (
      // Base UI Field wires the accessibility plumbing: Field.Label's htmlFor
      // targets the control, Field.Error's generated id lands in the control's
      // aria-describedby, and `invalid` drives aria-invalid / data-invalid.
      <Field.Root
        ref={rowRef}
        invalid={!!error}
        disabled={disabled}
        className={cn(
          'flex cursor-text flex-col gap-1',
          disabled && 'pointer-events-none opacity-50',
          className,
        )}
      >
        {/* Label — sr-only when hidden so the field keeps its accessible
            name and the htmlFor wiring. */}
        <Field.Label
          className={cn(
            labelHidden ? 'sr-only' : 'inline-grid',
            sizeClasses.text,
            // One notch tighter than the ladder's control padding — the field
            // ring is invisible at rest, so the roomier inset reads as a gap.
            !labelHidden && (compact ? 'pl-2' : 'pl-2.5'),
          )}
        >
          <span
            className="invisible col-start-1 row-start-1"
            style={{ fontVariationSettings: fontWeights.semibold }}
            aria-hidden="true"
          >
            {label}
          </span>
          <span
            className={cn(
              'col-start-1 row-start-1',
              error ? 'text-destructive' : 'text-muted-foreground',
            )}
            style={{
              fontVariationSettings: fontWeights.normal,
            }}
          >
            {label}
          </span>
        </Field.Label>

        {/* Input container. Presentational: the <input> inside is the real
            control, and this box only widens its hit area, so it carries no
            role or keyboard handling of its own. */}
        <div
          role="presentation"
          onMouseDown={(e) => {
            // The old wrapper was one big <label>, so a click anywhere (icon,
            // padding) focused the input. Keep that, without disturbing the
            // input's own caret placement.
            if (e.target === inputRef.current) return;
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className={cn(
            // Fixed height (was py-2 around the line box) so the field sits
            // exactly on the ladder's control height.
            `flex items-center ${sizeClasses.gap} ${shape.input} ${
              compact ? 'px-2' : 'px-2.5'
            } ${sizeClasses.control} ring-1 transition-all duration-fast`,
            bgClass,
            ringClass,
          )}
        >
          {Icon && (
            <Icon
              size={sizeClasses.icon}
              strokeWidth={glyphLit && !outlined ? 2 : 1.5}
              className={cn(
                'shrink-0 transition-[color,stroke-width] duration-fast',
                glyphLit ? 'text-foreground' : 'text-muted-foreground',
              )}
            />
          )}
          <Field.Control
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={placeholder}
            className={cn(
              'w-full bg-transparent font-[inherit] text-foreground outline-none',
              // An outlined field's own box says it can be typed into, so the
              // placeholder is only a name and recedes a step further — the
              // grey the sidebar's group labels wear.
              outlined
                ? 'placeholder:text-muted-foreground/70'
                : 'placeholder:text-muted-foreground',
              sizeClasses.text,
              // A whole-pixel line box: the type's own 1.5 leading made the
              // input 19.5px tall, so centring it in the control left it on a
              // quarter pixel and the caret drew blurred and taller than the
              // letters. 16px at the default interface size, scaled with it
              // and rounded to an even pixel, keeps it on the grid at every
              // size and tall enough that the input never clips its glyphs.
              'leading-[round(calc(16px*var(--ui-scale,1)),2px)]',
              // The input clips to its own box, and a caret before the first
              // character straddles that edge, so its left half was cut off.
              // One pixel of padding gives it room; the matching negative
              // margin keeps the text where it was.
              '-mx-px px-px',
            )}
            style={{ fontVariationSettings: fontWeights.normal }}
            {...props}
          />

          {/* Pulled a step past the box's own padding so the control's glyph
              sits on the inset the text keeps, not one padding further in. */}
          {action && (
            <span className={cn('flex shrink-0 items-center', compact ? '-mr-1' : '-mr-1.5')}>
              {action}
            </span>
          )}
        </div>

        {/* Error message — `match` pins it visible while our controlled
            `error` prop is standing. */}
        {error && (
          <Field.Error
            match
            className={cn('text-destructive', sizeClasses.caption, compact ? 'pl-2' : 'pl-2.5')}
            style={{ fontVariationSettings: fontWeights.medium }}
          >
            {error}
          </Field.Error>
        )}
      </Field.Root>
    );
  },
);

InputField.displayName = 'InputField';

export { InputGroup, InputField };
