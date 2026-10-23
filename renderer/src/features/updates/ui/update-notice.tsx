/** The update offer in the sidebar footer. The view model owns copy and
 * commands; the same card renders real offers and isolated developer previews. */
import type { UpdateNoticeViewModel } from '@/features/updates/hooks/use-update-notice';
import { CornerNotice } from '@/shared/ui/notice';

export function UpdateNotice({
  notice,
  preview = false,
}: {
  notice: UpdateNoticeViewModel;
  preview?: boolean;
}) {
  const { failure, offer } = notice;
  const sentence = failure?.message ?? offer?.message ?? null;
  if (sentence === null) return null;

  return (
    <CornerNotice
      action={
        offer?.actionLabel
          ? { label: offer.actionLabel, onAct: notice.act, recovery: offer.recovers === true }
          : null
      }
      dismissLabel="Dismiss update notification"
      onDismiss={notice.dismiss}
      role={failure?.tone === 'input' ? 'alert' : 'status'}
    >
      {preview && <p className="font-medium text-muted-foreground">Update preview</p>}
      <p>{sentence}</p>
    </CornerNotice>
  );
}
