/**
 * A path that gives up its start when it runs out of room. The start is where
 * paths tell each other apart least: the home prefix is the same on every row,
 * and the last directories are what differ. The right-to-left box puts the
 * ellipsis on the left; the `bdi` keeps the path itself reading left to right,
 * so its slashes stay where they belong.
 */
import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export function PathTail({
  className,
  path,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { path: string }) {
  return (
    <span {...props} className={cn('min-w-0 truncate text-left [direction:rtl]', className)}>
      <bdi dir="ltr">{path}</bdi>
    </span>
  );
}
