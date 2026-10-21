import { useState } from 'react';

import { systemEntryPath, type WorkspaceEntry } from '@/features/workspace/domain/tree';
import { writeToClipboard } from '@/shared/ui/clipboard';
import { FailureLine } from '@/shared/ui/failure-notice';

export function useTreeClipboard(folderPath: string) {
  const [refused, setRefused] = useState(false);
  return {
    refused,
    copy: (entry: WorkspaceEntry, form: 'absolute' | 'relative') =>
      void writeToClipboard(systemEntryPath(folderPath, entry.path, form)).then(
        () => setRefused(false),
        () => setRefused(true),
      ),
  };
}

export function ClipboardFailure() {
  return (
    <FailureLine className="px-2 pt-2" tone="capability">
      StashBase could not reach the clipboard.
    </FailureLine>
  );
}
