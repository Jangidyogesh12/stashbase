/**
 * The one place the account wire shapes are spoken.
 *
 * The transport models an absent profile field as a missing key and lets a
 * failed sign-in answer without a sentence; the feature's own vocabulary
 * (`domain/account.ts`) models absence as `null` and gives every failure a
 * sentence. The mappers below are that translation, so nothing above this
 * adapter imports a protocol module. Account identity is independent from
 * search by meaning.
 */
import type { AccountPort } from '@/features/settings/application/ports';
import type {
  AccountOffer,
  HostedAccount,
  HostedSignIn,
  HostedSignInStatus,
} from '@/features/settings/domain/account';
import { settingsRequest } from '@/features/settings/infrastructure/settings-request';
import { request } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import {
  hostedAccountOfferSchema,
  hostedAccountStateSchema,
  hostedOAuthStartRequestSchema,
  hostedOAuthStartResponseSchema,
  hostedOAuthStatusSchema,
  type HostedAccountStateWire,
  type HostedOAuthStartResponseWire,
  type HostedOAuthStatusWire,
} from '@/protocols/http/embedder';

function toAccount(wire: HostedAccountStateWire): HostedAccount {
  return {
    avatarUrl: wire.avatarUrl ?? null,
    displayName: wire.displayName ?? null,
    email: wire.email ?? null,
    // An offer this build does not know is not shown.
    offers: (wire.offers ?? []).filter((offer): offer is AccountOffer => offer === 'sign-in'),
    signedIn: wire.signedIn,
  };
}

function toSignIn(wire: HostedOAuthStartResponseWire): HostedSignIn {
  return { flowId: wire.flowId, url: wire.url };
}

function toSignInStatus(wire: HostedOAuthStatusWire): HostedSignInStatus {
  switch (wire.state) {
    case 'complete':
      return { state: 'complete' };
    case 'error':
      return { state: 'error', error: wire.error ?? 'Sign-in failed.' };
    case 'pending':
      return { state: 'pending' };
  }
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** The picture travels as bytes rather than as an image URL: the page may
 *  only paint images it holds as a blob, so the JSON client cannot carry it
 *  and the adapter speaks to the server origin directly, as uploads do. */
export function createAccountAdapter(
  client: HttpClient,
  serverOrigin: string,
  fetchRequest: Fetch = fetch,
): AccountPort {
  const avatarTarget = new URL('/api/account/avatar', serverOrigin);
  return {
    async avatar(signal) {
      try {
        const response = await fetchRequest(avatarTarget, { signal });
        if (!response.ok) return null;
        return await response.blob();
      } catch (error) {
        if (signal.aborted) throw error;
        return null;
      }
    },
    async load(signal) {
      return toAccount(
        await request(client, {
          ...settingsRequest({ path: '/api/account', signal }),
          schema: hostedAccountStateSchema,
        }),
      );
    },
    async markOfferSeen(offer, signal) {
      return toAccount(
        await request(client, {
          ...settingsRequest({
            path: `/api/account/offers/${hostedAccountOfferSchema.parse(offer)}/seen`,
            signal,
          }),
          method: 'POST',
          schema: hostedAccountStateSchema,
        }),
      );
    },
    async resetOffers(signal) {
      return toAccount(
        await request(client, {
          ...settingsRequest({ path: '/api/account/offers', signal }),
          method: 'DELETE',
          schema: hostedAccountStateSchema,
        }),
      );
    },
    async signInStatus(flowId, signal) {
      const query = new URLSearchParams({ flow: flowId });
      return toSignInStatus(
        await request(client, {
          ...settingsRequest({ path: `/api/account/oauth/status?${query}`, signal }),
          schema: hostedOAuthStatusSchema,
        }),
      );
    },
    async signOut(signal) {
      return toAccount(
        await request(client, {
          ...settingsRequest({ path: '/api/account', signal }),
          method: 'DELETE',
          schema: hostedAccountStateSchema,
        }),
      );
    },
    async startSignIn(signal) {
      return toSignIn(
        await request(client, {
          ...settingsRequest({ path: '/api/account/oauth/start', signal }),
          body: hostedOAuthStartRequestSchema.parse({ provider: 'google', purpose: 'account' }),
          method: 'POST',
          schema: hostedOAuthStartResponseSchema,
        }),
      );
    },
  };
}
