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

function paidDate(value: string): string {
  return new Date(value).toLocaleDateString([], { dateStyle: 'medium' });
}

function subscriptionDetail(status: BillingStatus): string {
  if (billingPaid(status) && status.paidThrough) {
    const plan = status.planName ?? 'Paid plan';
    return status.cancelAtPeriodEnd
      ? `${plan} · Renewal canceled. Access until ${paidDate(status.paidThrough)}`
      : `${plan} · Paid through ${paidDate(status.paidThrough)}`;
  }
  return 'Paid credits are not active. Check your payment.';
}

/** Cancel is named only while something could still renew: a subscription
 *  that has not been canceled, or a payment the API has yet to confirm. After
 *  cancellation the same portal only shows billing. */
function manageLabel(billing: BillingViewModel): string {
  const { status } = billing;
  const renewing =
    billing.confirming !== null ||
    (status !== null && billingSubscribed(status) && !status.cancelAtPeriodEnd);
  return renewing ? 'Manage or cancel' : 'Manage billing';
}

export function SubscriptionRows({ billing }: { billing: BillingViewModel }) {
  const { status } = billing;
  const failure = billing.failure && <FailureNotice className="mt-1" failure={billing.failure} />;

  const manage = status?.canManage && (
    <Button
      disabled={billing.busy}
      loading={billing.opening === 'portal'}
      onClick={billing.manage}
      size="compact"
      variant="tertiary"
    >
      {billing.opening === 'portal' ? 'Opening browser…' : manageLabel(billing)}
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
        detail={
          billing.confirming === 'waiting'
            ? 'Waiting for payment in your browser.'
            : 'Payment is not confirmed yet. Refresh or check your subscription in the browser.'
        }
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
      <SettingsRow as="li" detail={subscriptionDetail(status)} title="Plan" trail={manage}>
        {failure}
        {browserHelp}
      </SettingsRow>
    );
  }

  return (
    <>
      <SettingsRow
        as="li"
        detail="Free · Paid plans add monthly credits."
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
      {billing.plans.map((plan) => (
        <SettingsRow
          as="li"
          detail={billingPrice(plan)}
          key={plan.priceId}
          title={plan.name}
          titleTone={plan.available ? 'default' : 'muted'}
          trail={
            <Button
              disabled={billing.busy || !plan.available}
              onClick={() => billing.subscribe(plan.priceId)}
              size="compact"
              variant="tertiary"
            >
              {billing.opening === 'checkout'
                ? 'Opening payment…'
                : plan.available
                  ? 'Subscribe'
                  : 'Coming soon'}
            </Button>
          }
        />
      ))}
    </>
  );
}
