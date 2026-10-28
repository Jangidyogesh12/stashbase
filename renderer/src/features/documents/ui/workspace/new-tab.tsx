/**
 * The New tab's page: a few quiet ways to start, centred on the document
 * slot. The tab itself is the strip's; this is what the card shows while it
 * is selected, over the active document.
 */
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface NewTabPageProps {
  className?: string;
  /** Closes the tab: the active document, if any, shows again. */
  onClose(): void;
  /** Starts a draft the way the folder header's New file does; the draft
   *  opening in front is what takes the New tab away. */
  onCreateDraft(): void;
  onCreateInteractiveNote(): void;
}

export function NewTabPage({
  className,
  onClose,
  onCreateDraft,
  onCreateInteractiveNote,
}: NewTabPageProps) {
  return (
    <section
      aria-label="New tab"
      className={cn(
        'flex h-full flex-col items-center justify-center gap-1 bg-surface-2',
        className,
      )}
    >
      <Button onClick={onCreateDraft} variant="ghost">
        Create text note
      </Button>
      <Button onClick={onCreateInteractiveNote} variant="ghost">
        Create interactive note
      </Button>
      <Button onClick={onClose} variant="ghost">
        Close
      </Button>
    </section>
  );
}
