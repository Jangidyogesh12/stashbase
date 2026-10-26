import type { AccountPort, AgentRuntimePort } from '@/features/settings/application/ports';
import type { BillingStatus } from '@/features/settings/domain/billing';
export const SIGNED_OUT = {
  avatarUrl: null,
  displayName: null,
  email: null,
  offers: [],
  signedIn: false,
} as const;

export const signedIn: AccountPort = {
  sendEmail: async () => ({ flowId: 'email-flow' }),
  verifyEmail: async () => ({ ...SIGNED_OUT, signedIn: true, email: 'ada@example.com' }),
  cancelEmail: async () => {},
  methods: async () => ({ email: 'ada@example.com', google: true }),
  sendEmailProof: async () => {},
  verifyEmailProof: async () => {},
  sendLinkCode: async () => {},
  linkGoogle: async () => ({ ticket: 'ticket', url: 'https://accounts.example/link' }),
  unlinkGoogle: async () => {},
  linkStatus: async () => ({ state: 'pending' }),
  avatar: async () => null,
  load: async () => ({
    avatarUrl: null,
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
    offers: [],
    signedIn: true,
  }),
  signInStatus: async () => ({ state: 'pending' }),
  markOfferSeen: async () => SIGNED_OUT,
  resetOffers: async () => SIGNED_OUT,
  signOut: async () => SIGNED_OUT,
  startSignIn: async () => ({ flowId: 'flow', url: 'https://accounts.example/sign-in' }),
};

const FREE: BillingStatus = {
  cancelAtPeriodEnd: false,
  canManage: false,
  paidThrough: null,
  planName: null,
  status: 'free',
};

export function accountRuntimePort(): AgentRuntimePort {
  return {
    getAllowance: async () => ({
      remainingPercent: 62,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      windowEndsAt: null,
    }),
    getBillingPlans: async () => [
      {
        amount: 500,
        planKey: 'plus',
        monthlyGrantPicodollars: 5e12,
        available: true,
        currency: 'usd',
        interval: 'month',
        name: 'Plus',
        priceId: 'price_plus',
      },
      {
        amount: 2000,
        planKey: 'pro',
        monthlyGrantPicodollars: 20e12,
        available: true,
        currency: 'usd',
        interval: 'month',
        name: 'Pro',
        priceId: 'price_pro',
      },
    ],
    getBillingStatus: async () => FREE,
    listAgents: async () => ({ runtimes: [], debug: null }),
    openBillingPortal: async () => 'https://billing.stripe.com/p/session/story',
    prepareAgent: async () => ({ runtimes: [], debug: null }),
    changeBilling: async () => {},
    startCheckout: async () => 'https://checkout.stripe.com/c/pay/story',
    updateDebug: async () => ({ runtimes: [], debug: null }),
  };
}
