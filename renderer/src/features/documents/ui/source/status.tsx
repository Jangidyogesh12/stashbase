import { LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  documentFailure,
  type FailureMessages,
} from '@/features/documents/application/failure-messages';

import type { DocumentViewerStatus } from './viewer';

export function DocumentPending({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center gap-2 text-caption text-muted-foreground"
      role="status"
    >
      <LoaderCircle
        aria-hidden="true"
        className="size-4 motion-safe:animate-spin"
        strokeWidth={1.5}
      />
      {label}
    </div>
  );
}

function DocumentFailure({
  message,
  name,
  retry,
}: {
  message: string;
  name: string;
  retry?: (() => void) | undefined;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8 text-center">
      <div className="max-w-md">
        <TriangleAlert
          aria-hidden="true"
          className="mx-auto size-8 text-muted-foreground"
          strokeWidth={1.5}
        />
        <h2 className="mt-3 text-body font-medium">Could not open {name}</h2>
        <p className="mt-1 text-caption leading-relaxed text-muted-foreground" role="alert">
          {message}
        </p>
        {retry && (
          <Button className="mt-4" onClick={retry} size="compact" variant="tertiary">
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

/** The panel an asset viewer shows in place of its content: the file's name
 *  while the bytes load, and why it could not be opened when they do not
 *  arrive. Plainer than `DocumentFailure` on purpose — this sits inside a
 *  viewer that is already framed and labelled, not in place of one. */
export function AssetStatus({
  detail,
  failed = false,
  name,
  retry,
}: {
  /** Why the asset could not be opened. Read only when `failed`. */
  detail?: string | undefined;
  failed?: boolean;
  name: string;
  retry?: (() => void) | undefined;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <p className="text-body font-medium">
          {failed ? `Could not open ${name}` : `Loading ${name}`}
        </p>
        {failed && (
          <>
            <p className="mt-1 text-caption text-muted-foreground" role="alert">
              {detail}
            </p>
            <Button className="mt-4" onClick={retry} size="compact" variant="tertiary">
              Retry
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Builds one format's status panel: the same pending row everywhere, and a
 * failure whose sentence comes from that format's own failure family.
 */
export function documentStatusRenderer<Extra extends string = never>(
  owner: string,
  messages: FailureMessages<Extra>,
): (status: DocumentViewerStatus) => ReactNode {
  return function renderStatus({ error, name, retry }: DocumentViewerStatus) {
    if (error === undefined) return <DocumentPending label={`Loading ${name}`} />;
    return (
      <DocumentFailure
        message={documentFailure<Extra>(error, owner, messages).message}
        name={name}
        retry={retry}
      />
    );
  };
}
