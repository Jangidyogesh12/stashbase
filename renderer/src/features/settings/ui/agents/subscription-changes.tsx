import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { BillingChange } from '@/features/settings/domain/billing';
import type { BillingViewModel } from '@/features/settings/hooks/use-billing';

/** Renewal changes stay in the signed-in desktop account; only paid upgrades
 * need Stripe's payment confirmation page. */
export function SubscriptionChanges({ billing }: { billing: BillingViewModel }) {
  const [confirmation, setConfirmation] = useState<BillingChange | null>(null);
  const { status } = billing;
  if (!status) return null;
  const plus = billing.plans.find((plan) => plan.planKey === 'plus' && plan.available);
  const messages = {
    downgrade:
      'Switch to Plus at the next renewal? Keep Pro and its remaining credits until then. There is no refund or credit for this period.',
    keep: 'Withdraw the scheduled downgrade and keep your current plan renewing at its listed price?',
    cancel:
      'Cancel automatic renewal? Keep your current allowance until this period ends. Any scheduled downgrade will be removed.',
    resume: 'Resume automatic renewal of your current plan at its listed price?',
  };
  return (
    <div className="space-y-2">
      {status.scheduledChange && (
        <p className="text-caption text-muted-foreground">
          Switching to{' '}
          {billing.plans.find((plan) => plan.priceId === status.scheduledChange?.priceId)?.name ??
            'your selected plan'}{' '}
          on{' '}
          {new Date(status.scheduledChange.effectiveAt).toLocaleDateString([], {
            dateStyle: 'medium',
          })}
          .
        </p>
      )}
      {status.changePending && <p role="status">Confirming your subscription change…</p>}
      {status.changeError && <p role="alert">{status.changeError}</p>}
      {confirmation ? (
        <div className="space-y-1">
          <p className="text-caption">{messages[confirmation.action]}</p>
          <div className="flex flex-wrap gap-1">
            <Button
              disabled={billing.busy}
              onClick={() => {
                billing.change(confirmation);
                setConfirmation(null);
              }}
              size="compact"
              variant="tertiary"
            >
              Confirm change
            </Button>
            <Button onClick={() => setConfirmation(null)} size="compact" variant="ghost">
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {status.scheduledChange ? (
            <Button
              disabled={billing.busy}
              onClick={() => setConfirmation({ action: 'keep' })}
              size="compact"
              variant="tertiary"
            >
              Keep current plan
            </Button>
          ) : status.planKey === 'pro' &&
            status.status === 'active' &&
            !status.cancelAtPeriodEnd &&
            plus ? (
            <Button
              disabled={billing.busy}
              onClick={() => setConfirmation({ action: 'downgrade', priceId: plus.priceId })}
              size="compact"
              variant="tertiary"
            >
              Switch to Plus next renewal
            </Button>
          ) : null}
          <Button
            disabled={billing.busy}
            onClick={() =>
              setConfirmation({ action: status.cancelAtPeriodEnd ? 'resume' : 'cancel' })
            }
            size="compact"
            variant="tertiary"
          >
            {status.cancelAtPeriodEnd ? 'Resume automatic renewal' : 'Cancel automatic renewal'}
          </Button>
        </div>
      )}
      <p className="text-caption text-muted-foreground">
        Paid upgrades add a proportional share of the extra plan credits based on your payment and
        keep your current usage. A trial upgrade ends the trial and starts a paid Pro month with its
        full allowance.
      </p>
    </div>
  );
}
