/** The Default Agent's plan rows: the account's plan, the tiers it can buy,
 *  or the wait for a browser payment to confirm. */
import { Button } from '@/components/ui/button';
import {
  billingPaid,
  billingPrice,
  billingSubscribed,
  type BillingStatus,
} from '@/features/settings/domain/billing';
import type { BillingViewModel } from '@/features/settings/hooks/use-billing';
import { SettingsMessage, SettingsRow } from '@/features/settings/ui/rows';
import { FailureNotice } from '@/shared/ui/failure-notice';

import { SubscriptionChanges } from './subscription-changes';

function paidDate(value: string): string {
  return new Date(value).toLocaleDateString([], { dateStyle: 'medium' });
}

function subscriptionDetail(status: BillingStatus): string {
  if (billingPaid(status) && status.paidThrough) {
    const plan = status.planName ?? 'Paid plan';
    return status.cancelAtPeriodEnd
      ? `${plan} · Renewal cancelled. Access until ${paidDate(status.paidThrough)}`
      : status.status === 'trialing'
        ? `${plan} · Free trial until ${paidDate(status.paidThrough)}. Then $5 a month.`
        : `${plan} · Credits until ${paidDate(status.paidThrough)}`;
  }
  return 'Paid credits are not active. Check your payment.';
}

/** Cancel is named only while something could still renew: a subscription
 *  that has not been canceled, or a payment the API has yet to confirm. After
 *  cancellation the same portal only shows billing. */
function manageLabel(billing: BillingViewModel): string {
  const { status } = billing;
  if (status?.scheduledChange) return 'Manage billing';
  const renewing =
    billing.confirming !== null ||
    (status !== null && billingSubscribed(status) && !status.cancelAtPeriodEnd);
  return renewing ? 'Manage or cancel' : 'Manage billing';
}

/** The Plan row's detail, or what its Manage button is waiting for while it
 *  is: a working button keeps its name, and the row says what it awaits. */
function planDetail(billing: BillingViewModel, detail: string): string {
  return billing.opening?.page === 'portal'
    ? 'Opening subscription management in your browser.'
    : detail;
}

export function SubscriptionRows({ billing }: { billing: BillingViewModel }) {
  const { status } = billing;
  const failure = billing.failure && <FailureNotice className="mt-1" failure={billing.failure} />;

  const manage = status?.canManage && (
    <Button
      disabled={billing.busy}
      loading={billing.opening?.page === 'portal'}
      onClick={billing.manage}
      size="compact"
      variant="tertiary"
    >
      {manageLabel(billing)}
    </Button>
  );
  const browserHelp = billing.browserPage === 'portal' && !billing.busy && !billing.failure && (
    <p className="text-caption text-muted-foreground">
      Finish in your browser, then return here. If it did not open, try again.
    </p>
  );

  if (billing.confirming) {
    return (
      <SettingsRow
        as="li"
        detail={planDetail(
          billing,
          billing.confirming === 'waiting'
            ? 'Waiting for payment in your browser.'
            : 'Payment is not confirmed yet. Refresh or check your subscription in the browser.',
        )}
        title="Plan"
        trail={manage}
      >
        {failure}
        {browserHelp}
        <div className="flex flex-wrap gap-1">
          {billing.confirming === 'slow' && (
            <Button onClick={billing.refresh} size="compact" variant="tertiary">
              Refresh
            </Button>
          )}
          <Button onClick={billing.stopWaiting} size="compact" variant="ghost">
            Dismiss
          </Button>
        </div>
      </SettingsRow>
    );
  }

  if (status === null) {
    return billing.statusFailed ? (
      <SettingsMessage
        as="li"
        message="Could not load your subscription."
        onRetry={billing.refresh}
      />
    ) : (
      <SettingsMessage as="li" message="Checking subscription…" />
    );
  }

  if (billingSubscribed(status)) {
    return (
      <SettingsRow
        as="li"
        detail={planDetail(billing, subscriptionDetail(status))}
        title="Plan"
        trail={manage}
      >
        <SubscriptionChanges billing={billing} />
        {failure}
        {browserHelp}
      </SettingsRow>
    );
  }

  return (
    <>
      <SettingsRow
        as="li"
        detail={planDetail(billing, 'Free · Credits refresh each month.')}
        title="Plan"
        trail={manage}
      >
        {failure}
        {browserHelp}
      </SettingsRow>
      {billing.plansFailed && (
        <SettingsMessage
          as="li"
          message="Plans are unavailable right now."
          onRetry={billing.refresh}
        />
      )}
      {billing.plans.map((plan) => {
        // Only the plan the reader pressed waits; the others stay still.
        const opening =
          billing.opening?.page === 'checkout' && billing.opening.priceId === plan.priceId;
        return (
          <SettingsRow
            as="li"
            detail={
              opening
                ? 'Opening the payment page in your browser.'
                : `${billingPrice(plan)}${plan.planKey === 'pro' ? ' · 10× the Plus credits' : ''}`
            }
            key={plan.priceId}
            title={plan.name}
            titleTone={plan.available ? 'default' : 'muted'}
            trail={
              <Button
                disabled={billing.busy || !plan.available}
                loading={opening}
                onClick={() => billing.subscribe(plan.priceId)}
                size="compact"
                variant="tertiary"
              >
                {plan.available ? 'Subscribe' : 'Coming soon'}
              </Button>
            }
          >
            {plan.planKey === 'plus' && (
              <p className="text-caption text-muted-foreground">
                First subscription: first month free with a card and automatic renewal. Then{' '}
                {billingPrice(plan)}. Cancel anytime.
              </p>
            )}
          </SettingsRow>
        );
      })}
    </>
  );
}
