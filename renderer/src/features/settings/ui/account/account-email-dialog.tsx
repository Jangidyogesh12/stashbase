/** Shared modal chrome for sign-in and mailbox verification. */
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { FailureView } from '@/shared/domain/feature-error';
import { FailureNotice } from '@/shared/ui/failure-notice';

import { AccountEmailFields } from './account-email-fields';

export function AccountEmailDialog({
  title,
  description,
  email,
  onEmailChange,
  access,
  submitLabel,
  onClose,
  alternative,
  waiting,
  unavailable = false,
}: {
  title: string;
  description: string;
  email: string;
  onEmailChange?: ((value: string) => void) | undefined;
  access: ComponentProps<typeof AccountEmailFields>['access'] & {
    verify(): void;
    failure: FailureView | null;
  };
  submitLabel: string;
  onClose(): void;
  alternative?: ReactNode;
  waiting?: ReactNode;
  unavailable?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const editableEmail = Boolean(onEmailChange);
  useEffect(() => {
    if (!access.busy && !waiting)
      form.current
        ?.querySelector<HTMLElement>(
          access.sent
            ? 'input[autocomplete="one-time-code"]'
            : editableEmail
              ? 'input'
              : 'button[type="submit"]',
        )
        ?.focus();
  }, [access.sent, access.busy, waiting, editableEmail]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader className="text-center">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-caption">
          {!waiting && (
            <>
              <form
                ref={form}
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!access.busy && !unavailable && (access.sent || access.remaining === 0)) {
                    if (access.sent) access.verify();
                    else access.send();
                  }
                }}
              >
                <AccountEmailFields email={email} onEmailChange={onEmailChange} access={access} />
                <Button
                  className="w-full"
                  type="submit"
                  loading={access.busy}
                  disabled={access.busy || unavailable || (!access.sent && access.remaining > 0)}
                >
                  {access.sent
                    ? submitLabel
                    : access.remaining > 0
                      ? `Send code in ${access.remaining}s`
                      : 'Send email code'}
                </Button>
              </form>
              {alternative}
            </>
          )}
          {waiting}
          {access.failure && <FailureNotice failure={access.failure} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
