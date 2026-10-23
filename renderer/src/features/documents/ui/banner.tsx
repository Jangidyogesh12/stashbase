import { NoticeStrip } from '@/shared/ui/notice';

/** A refresh that failed over a preview still on screen. */
export function RefreshFailedBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <NoticeStrip action={{ label: 'Retry', onAct: onRetry }} role="status">
      Refresh failed. Showing the last loaded preview.
    </NoticeStrip>
  );
}
