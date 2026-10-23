import { Button } from '@/components/ui/button';
import { FailureLine } from '@/shared/ui/failure-notice';

export interface GalleryRecovery {
  pending: boolean;
  retry(): void;
}

export function GalleryIndexRecovery({ recovery }: { recovery: GalleryRecovery | null }) {
  if (!recovery) return null;
  return (
    <div className="mb-3 flex shrink-0 items-center gap-3">
      <FailureLine className="m-0" tone="capability">
        The latest Gallery is unavailable. You can still browse the saved projects.
      </FailureLine>
      <Button loading={recovery.pending} onClick={recovery.retry} size="compact" variant="tertiary">
        Retry
      </Button>
    </div>
  );
}
