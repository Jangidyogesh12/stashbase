/** What the user types into: the slot a consumer fills with its own field.
 *
 *  The composer used to ship a built-in textarea beside this — auto-resizing,
 *  with a ghost-placeholder overlay, history recall and a suggestion listbox
 *  reading its caret. Nothing in the product ever rendered it; the one
 *  consumer supplies a rich mention editor, and a second field the kit
 *  maintained but nobody mounted is a second set of keyboard behaviours to
 *  keep correct against no evidence. So the slot is the field, and this module
 *  owns the one thing the composer still decides about it: the step
 *  typography, handed over as pixels so the consumer's text lands exactly
 *  where the composer's chrome expects it.
 *
 *  Keyboard behaviour belongs to the field. The composer contributes only
 *  `submit`, which is what Enter does. */
'use client';

import { type ReactNode, type RefObject } from 'react';

import { useSize } from '@/lib/size-context';

/** Placeholder shown while a file drag hovers the composer. */
export const DROP_HINT = 'Drop files here to add to chat';

/** What a consumer-owned editor needs in order to be the composer's field. */
export interface InputMessageEditorContext {
  value: string;
  onValueChange(value: string): void;
  /** Exactly what Enter does on the textarea: send, or while streaming hand
   *  the draft to the running response (when the owner takes that) or queue
   *  it. `queue` keeps a mid-response submit in the queue either way. */
  submit(options?: { queue?: boolean }): void;
  disabled: boolean;
  /** Already swapped to the drop hint while a file drag hovers. */
  placeholder: string;
  /** The placeholder is a request rather than a hint, so Tab may fill the
   *  empty field with it. Never true while the drop hint shows. */
  acceptPlaceholder?: boolean;
  minRows: number;
  maxRows: number;
  /** The composer's step typography, so the field's text sits exactly where
   *  the chrome around it expects it. */
  metrics: { fontSize: number; lineHeight: number; paddingX: number; paddingY: number };
  ariaLabel: string;
  ariaDescribedBy?: string | undefined;
}

/** The slice of `InputMessage`'s public surface this concern owns. */
export interface InputMessageEditorProps {
  /** Placeholder text shown when the value is empty. */
  placeholder?: string;
  /** The placeholder is a request the reader may take as written: Tab on an
   *  empty field fills it in, without sending. */
  placeholderIsPrompt?: boolean;
  /** Minimum visible rows before the field grows. */
  minRows?: number;
  /** Maximum visible rows before the field starts to scroll. */
  maxRows?: number;
  /** The accessible name and description for the consumer's field. The
   *  composer has no control of its own to name, so both pass straight through
   *  to the editor slot. */
  fieldProps?: { 'aria-label'?: string; 'aria-describedby'?: string };
}

/** A consumer-owned editor: the composer's field. The composer keeps its
 *  chrome around it — preview row, queue, slots, send button, drop handling —
 *  and contributes `submit`; everything the field does with a keystroke is the
 *  field's own. */
export type InputMessageEditorSlot = (ctx: InputMessageEditorContext) => ReactNode;

/** The composer's step typography as pixel values, for the consumer's field. */
const metricsForStep = (compactStep: boolean) =>
  compactStep
    ? { fontSize: 13, lineHeight: 18, paddingX: 6, paddingY: 6 }
    : { fontSize: 14, lineHeight: 20, paddingX: 8, paddingY: 8 };

interface ConsumerEditorSlotProps {
  /** The consumer's editor, rendered in place of the textarea. */
  editor: (context: InputMessageEditorContext) => ReactNode;
  /** Host the composer focuses through, by finding the contenteditable in it. */
  hostRef: RefObject<HTMLDivElement | null>;
  /** Everything the editor is handed except the step typography, which this
   *  module derives from the composer's own size step. */
  field: Omit<InputMessageEditorContext, 'metrics'>;
}

/** Mounts the consumer's field, deriving the one thing the composer decides
 *  about it — the step typography — from the composer's own size step. */
export function ConsumerEditorSlot({ editor, hostRef, field }: ConsumerEditorSlotProps) {
  const compactStep = useSize().variant === 'compact';

  return (
    <div className="relative" ref={hostRef}>
      {editor({ ...field, metrics: metricsForStep(compactStep) })}
    </div>
  );
}
