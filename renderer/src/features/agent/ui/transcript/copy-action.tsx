import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { ChatMessageAction } from '@/components/ui/chat-message';
import { writeToClipboard } from '@/shared/ui/clipboard';

/** Copies the untouched source text; the glyph confirms for a moment. */
export function CopyAction({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void writeToClipboard(text).then(
      () => {
        setCopied(true);
        globalThis.setTimeout(() => setCopied(false), 1_500);
      },
      // A host that refused the write has not copied anything, so the glyph
      // stays as it was rather than confirming something that did not happen.
      () => undefined,
    );
  };
  return (
    <ChatMessageAction
      icon={copied ? Check : Copy}
      label={copied ? 'Copied' : label}
      onClick={copy}
    />
  );
}
