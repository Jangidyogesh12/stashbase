/**
 * The account dialog's own state: the email code it sends and checks, the
 * Google connection it waits on in the browser, and the sign-in methods it
 * lists. A browser wait keeps its page link and a way to stop, like every
 * other sign-in wait.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { settingsFailure } from '@/features/settings/application/failure-messages';
import type { AccountPort } from '@/features/settings/application/ports';
import type { AccountViewModel } from '@/features/settings/hooks/use-account';
import { useSettingsCommand } from '@/features/settings/hooks/use-settings-command';
import type { FailureView } from '@/shared/domain/feature-error';

/** A Google identity that did not connect. The code it used is spent, so the
 *  way on is a new one. */
const LINK_FAILED: FailureView = {
  message:
    'Google could not be connected. It may already belong to another account. Request a new code to try again.',
  tone: 'input',
};

/** Transient proofs only; the host owns durable credentials and login retirement. */
export function useAccountAccess(port: AccountPort, account: AccountViewModel) {
  const managing = account.account?.signedIn === true;
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [ticket, setTicket] = useState<string | null>(null);
  /** The Google consent page the open connection started on. */
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);
  const flow = useRef<string | null>(null);
  const methods = useQuery({
    queryKey: ['account-methods', account.account?.email],
    queryFn: ({ signal }) => port.methods(signal),
    enabled: managing,
    retry: false,
  });
  const refreshMethods = methods.refetch;
  const link = useQuery({
    queryKey: ['account-link', ticket],
    queryFn: ({ signal }) => port.linkStatus(ticket ?? '', signal),
    enabled: ticket !== null,
    refetchInterval: (q) => (q.state.data?.state === 'pending' ? 1500 : false),
    retry: false,
  });
  useEffect(() => {
    if (!ticket || (!link.isError && (!link.data || link.data.state === 'pending'))) return;
    setTicket(null);
    setLinkUrl(null);
    setLinkFailed(link.isError || link.data?.state !== 'complete');
    setSent(false);
    setOtp('');
    void refreshMethods();
  }, [ticket, link.data, link.isError, refreshMethods]);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  useEffect(
    () => () => {
      if (flow.current)
        void port.cancelEmail(flow.current).catch(() => {
          // swallowed: cancellation is best effort; the host flow also expires.
        });
    },
    [port],
  );
  const command = useSettingsCommand<'send' | 'verify', void>(
    'accountAccess',
    async (action, signal) => {
      setLinkFailed(false);
      if (action === 'send') {
        if (managing) await port.sendLinkCode(signal);
        else {
          const started = await port.sendEmail(email.trim(), signal);
          if (signal.aborted) {
            await port.cancelEmail(started.flowId);
            signal.throwIfAborted();
          }
          flow.current = started.flowId;
        }
        signal.throwIfAborted();
        setSent(true);
        setRemaining(60);
        setOtp('');
      } else if (!managing) {
        const next = await port.verifyEmail(flow.current ?? '', otp, signal);
        signal.throwIfAborted();
        flow.current = null;
        account.emailSignedIn(next);
      } else if (methods.data?.google) {
        await port.unlinkGoogle(otp, signal);
        signal.throwIfAborted();
        setSent(false);
        setOtp('');
        await methods.refetch();
      } else {
        const started = await port.linkGoogle(otp, signal);
        signal.throwIfAborted();
        setOtp('');
        // The wait starts whatever the browser answers, as account sign-in
        // does: one that did not open leaves the reader the page to open,
        // rather than a spent code and a new one to request.
        setLinkUrl(started.url);
        setTicket(started.ticket);
        void Promise.resolve(account.openExternal(started.url)).catch(() => false);
      }
    },
  );
  /** Stops following the Google connection. Consent already given in the
   *  browser is not revoked, and the code it used is spent. */
  const stopWaiting = () => {
    setTicket(null);
    setLinkUrl(null);
    setSent(false);
    setOtp('');
  };
  const changeEmail = () => {
    if (flow.current)
      void port.cancelEmail(flow.current).catch(() => {
        // swallowed: cancellation is best effort; the host flow also expires.
      });
    flow.current = null;
    setSent(false);
    setOtp('');
  };
  return {
    managing,
    email,
    setEmail,
    otp,
    setOtp,
    sent,
    remaining,
    methods: methods.data,
    loading: managing && methods.isPending,
    busy: command.busy || ticket !== null,
    failure:
      command.failure ??
      (linkFailed ? LINK_FAILED : null) ??
      (methods.isError ? settingsFailure(methods.error) : null),
    waiting: ticket !== null,
    /** The Google consent page while the connection waits on it. */
    signInUrl: ticket !== null ? linkUrl : null,
    stopWaiting,
    send: () => command.run('send'),
    verify: () => command.run('verify'),
    changeEmail,
    retryMethods: () => {
      void refreshMethods();
    },
  };
}
