import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import type { UpdateStatus } from '@/features/updates/domain/update-status';

const VERSION = '9.9.9';
/** The phases the sidebar announces. Finding and downloading a release stay quiet. */
const PREVIEWS: ReadonlyArray<{ label: string; value: string; status: UpdateStatus }> = [
  { label: 'Ready to install', value: 'ready', status: { phase: 'ready', version: VERSION } },
  { label: 'Installing', value: 'installing', status: { phase: 'installing', version: VERSION } },
  { label: 'Update failed', value: 'error', status: { phase: 'error' } },
];

/** Controls for a preview rendered by the app in its real sidebar slot. */
export function UpdatePreview({
  active,
  onShow,
  onStop,
}: {
  active: boolean;
  onShow(status: UpdateStatus): void;
  onStop(): void;
}) {
  const id = useId();
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'ready', version: VERSION });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption text-muted-foreground">
        Show the update prompt in the sidebar. Preview actions do not install updates.
      </p>
      <div className="flex items-center justify-between gap-3">
        <label className="text-caption" htmlFor={id}>
          Update state
        </label>
        <Select
          items={PREVIEWS}
          value={status.phase}
          onValueChange={(value) => {
            const next = PREVIEWS.find((preview) => preview.value === value);
            if (next) {
              setStatus(next.status);
            }
          }}
          size="compact"
        >
          <SelectTrigger className="min-w-40" id={id} />
          <SelectContent>
            {PREVIEWS.map((preview) => (
              <SelectItem key={preview.value} value={preview.value}>
                {preview.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onShow(status)} size="compact" variant="tertiary">
          Preview in sidebar
        </Button>
        {active && (
          <Button onClick={onStop} size="compact" variant="ghost">
            Stop preview
          </Button>
        )}
      </div>
    </div>
  );
}
