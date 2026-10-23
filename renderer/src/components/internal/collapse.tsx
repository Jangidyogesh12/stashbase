/** The one measured collapse: a clipping box that travels between 0 and its
 *  content's measured pixel height.
 *
 *  Four wrappers in this kit animated exactly that — the composer's
 *  attachment and queue strips, the sidebar's sections and sub-menus, the
 *  reasoning trace's panels, and the space a newly arrived step opens — and
 *  each had rewritten the same three decisions. Never `height: "auto"`:
 *  framer resolves an auto target from the element's VISUAL size, which a
 *  scaled ancestor gets wrong, so the caller measures with `useMeasuredSize`
 *  and hands the pixels in. Never travel a height that moved underneath the
 *  animation: the box would chase its own child and land late. And never a
 *  fade that outruns the space closing under it.
 *
 *  What genuinely differed between them was one thing — whether a closed
 *  region keeps its children mounted — which is `presence`. The rest are
 *  options with defaults, so an ordinary disclosure still reads as two props.
 */

'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { collapseTween } from '@/lib/springs';
import { instant, useMotionTier } from '@/lib/use-motion-tier';
import { cn } from '@/lib/utils';

interface CollapseProps {
  open: boolean;
  /** The content's height in layout pixels, or null before the first
   *  measurement — which the box reads as zero. */
  height: number | null;
  children: ReactNode;
  /** `keep` (the default) leaves the children mounted at height 0, so a
   *  trigger's `aria-controls` target stays put and focus can still be
   *  restored into it. `unmount` removes them once the exit lands, for a
   *  region whose content means nothing while closed. */
  presence?: 'keep' | 'unmount';
  /** AnimatePresence key — stable for the life of one region. Only read under
   *  `presence="unmount"`. */
  regionKey?: string;
  /** `enter` fades in but not out: content that must hold its place until the
   *  space actually closes, because a simultaneous fade under a divider reads
   *  as a height glitch. Only `presence="unmount"` has an exit of its own to
   *  hold back, so `enter` reads as `both` under `keep`. `none` leaves opacity
   *  to the caller — a box whose content fades on its own timing.  */
  fade?: 'both' | 'enter' | 'none';
  /** The motion tier. `slow` is for a box opening space for content that has
   *  just arrived, where the travel is the arrival. */
  tier?: 'moderate' | 'slow';
  /** How the box answers a height change that is NOT a toggle. `snap` is for
   *  a collapse that can contain another one: when the nested section resizes
   *  the content, this box jumps to the new height instead of easing to it and
   *  landing after everything below has already moved. */
  retarget?: 'ease' | 'snap';
  /** Animate open from zero on first mount, rather than starting settled.
   *  Implied by `presence="unmount"`, which mounts nothing until it opens. */
  animateIn?: boolean;
  /** Hide the closed box from assistive technology. Off by default, because a
   *  box mid-exit is still on screen and still holds real controls: a caller
   *  that hides in step with its own timing — Base UI's `hidden`, a child that
   *  carries the attribute itself — says so there instead. */
  hideWhenClosed?: boolean;
  /** Lifts the clip once an open box has settled. A permanently clipped box
   *  shaves the focus ring off its first and last rows; a box that never clips
   *  shows content sliding out of a closing one. */
  unclipWhenSettled?: boolean;
  /** Fires when the closing animation lands, so a caller can defer something
   *  until the space is actually gone (Base UI's `hidden`). `keep` only:
   *  `unmount` has AnimatePresence's own exit hooks. */
  onExitComplete?: () => void;
  className?: string;
  id?: string;
  /** Names the box for a caller's own structural queries. */
  slot?: string;
}

export function Collapse({
  open,
  height,
  children,
  presence = 'keep',
  regionKey,
  fade = 'both',
  tier = 'moderate',
  retarget = 'ease',
  animateIn = false,
  hideWhenClosed = false,
  unclipWhenSettled = false,
  onExitComplete,
  className,
  id,
  slot,
}: CollapseProps) {
  const settle = useMotionTier(collapseTween[tier]);
  const retract = useMotionTier(collapseTween[tier].exit);
  const measured = height !== null;

  const [settled, setSettled] = useState(open);
  useEffect(() => {
    if (!open) setSettled(false);
  }, [open]);

  // Tracked with a ref so a controlled `open` is covered too, and cleared once
  // the toggle's own animation lands. Under `retarget: "ease"` every change is
  // a toggle as far as the transition is concerned.
  const prevOpenRef = useRef(open);
  const togglingRef = useRef(retarget === 'ease' || animateIn);
  if (prevOpenRef.current !== open) {
    prevOpenRef.current = open;
    togglingRef.current = true;
  }
  const toggling = retarget === 'ease' || togglingRef.current;

  if (presence === 'unmount') {
    return (
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key={regionKey}
            className={cn('overflow-hidden', className)}
            data-slot={slot}
            id={id}
            initial={{ height: 0, ...(fade === 'none' ? {} : { opacity: 0 }) }}
            // The height target waits for the measurement, the way the kept
            // box's does. A region that is already open when it mounts — a
            // panel arriving with its screen, a section a page opens on — is
            // put straight at this target by `initial={false}` above, so a
            // height of zero standing in for the unmeasured content would
            // make the first measurement a travel from nothing: the section
            // would unroll itself on arrival, having never been closed.
            // Unmeasured, the box simply keeps its content's own height, and
            // the pixels landing a frame later are the height it already has.
            // A real open still travels: entering through AnimatePresence
            // applies `initial`, and zero is where that one starts from.
            animate={{
              ...(measured ? { height } : {}),
              ...(fade === 'none' ? {} : { opacity: 1 }),
            }}
            exit={fade === 'both' ? { height: 0, opacity: 0 } : { height: 0 }}
            transition={settle}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  const opacity = fade === 'none' ? {} : { opacity: open ? 1 : 0 };
  return (
    <motion.div
      aria-hidden={hideWhenClosed && !open ? true : undefined}
      className={cn(
        unclipWhenSettled && open && settled ? 'overflow-visible' : 'overflow-hidden',
        !measured && !open && 'h-0',
        className,
      )}
      data-slot={slot}
      id={id}
      // `animate` stays defined from the first render — framer ignores an
      // animate prop that appears later in the element's life. Until the
      // content is measured, a closed box collapses via the h-0 class and an
      // open one keeps its natural height.
      initial={animateIn ? { height: 0, ...(fade === 'none' ? {} : { opacity: 0 }) } : false}
      animate={measured ? { height: open ? height : 0, ...opacity } : opacity}
      transition={toggling ? (open ? settle : retract) : instant}
      onAnimationComplete={() => {
        togglingRef.current = false;
        if (open) setSettled(true);
        else onExitComplete?.();
      }}
    >
      {children}
    </motion.div>
  );
}
