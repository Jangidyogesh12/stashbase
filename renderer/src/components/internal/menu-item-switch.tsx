/** The on/off track a toggle row draws at its trailing edge. It is a picture
 *  of a switch, not a control: the row is the `menuitemcheckbox` that owns
 *  the state, the focus, and the activation, so this draws only what the
 *  row says. Geometry and colour match `Switch`, so a toggle in a menu reads
 *  as the same control a settings row uses. */
'use client';

import { motion } from 'framer-motion';

import { useSize } from '@/lib/size-context';
import { spring } from '@/lib/springs';
import { useMotionTier } from '@/lib/use-motion-tier';
import { cn } from '@/lib/utils';

const THUMB_OFFSET = 2;

export function MenuItemSwitch({ on, className }: { on: boolean; className?: string }) {
  const m = useSize().switchGeometry;
  const slide = useMotionTier(spring.moderate);
  const travel = m.trackWidth - m.thumbSize - THUMB_OFFSET * 2;
  return (
    <span
      aria-hidden="true"
      className={cn('relative shrink-0 rounded-full transition-colors duration-fast', className)}
      style={{
        width: m.trackWidth,
        height: m.trackHeight,
        backgroundColor: on ? 'var(--control-on)' : 'var(--accent)',
      }}
    >
      <motion.span
        animate={{ x: on ? THUMB_OFFSET + travel : THUMB_OFFSET }}
        className="absolute left-0 block rounded-full bg-white shadow-sm"
        initial={false}
        style={{ top: THUMB_OFFSET, width: m.thumbSize, height: m.thumbSize }}
        transition={slide}
      />
    </span>
  );
}
