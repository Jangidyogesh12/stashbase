import { FloatingNotice, FloatingNotices } from '@/shared/ui/notice';

/** A link the reader followed that did not open in their browser. Nothing
 *  opened to carry the refusal, so it floats over the document; following
 *  the link again is the reader's own retry. Every viewer says it the same
 *  way. */
export function LinkFailureNotice({
  failed,
  onDismiss,
}: {
  failed: boolean;
  onDismiss: () => void;
}) {
  if (!failed) return null;
  return (
    <FloatingNotices>
      <FloatingNotice onDismiss={onDismiss} role="alert">
        Could not open this link in your browser.
      </FloatingNotice>
    </FloatingNotices>
  );
}
