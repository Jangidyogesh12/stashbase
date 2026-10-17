import { useEffect, useState } from 'react';

import type { AgentTranscriptBlock } from '@/features/agent/domain/session';

const PAGE_SIZE = 200;

/** Keep pending decisions reachable, and retain a page explicitly opened by a
 * notification after its one-shot focus target has been consumed. */
export function useTranscriptPage(blocks: AgentTranscriptBlock[], focusBlockId?: string) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const pendingIndex = blocks.findIndex(
    (block) => block.kind === 'tool' && block.status === 'awaiting' && block.permissionId,
  );
  const focusIndex = focusBlockId ? blocks.findIndex((block) => block.id === focusBlockId) : -1;
  useEffect(() => {
    if (focusIndex >= 0) setVisibleCount((count) => Math.max(count, blocks.length - focusIndex));
  }, [focusIndex, blocks.length]);
  return {
    hiddenCount: Math.min(
      Math.max(0, blocks.length - visibleCount),
      pendingIndex < 0 ? blocks.length : pendingIndex,
      focusIndex < 0 ? blocks.length : focusIndex,
    ),
    showEarlier: () => setVisibleCount((count) => count + PAGE_SIZE),
  };
}
