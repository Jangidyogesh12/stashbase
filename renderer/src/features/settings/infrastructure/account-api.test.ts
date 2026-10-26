import { describe, expect, it, vi } from 'vite-plus/test';

import type { HttpClient, HttpRequest } from '@/platform/http/client';

import { createAccountAdapter } from './account-api';

const signal = new AbortController().signal;
const ORIGIN = 'http://127.0.0.1:8090';
const noFetch = () => Promise.reject(new Error('not expected'));

describe('account API', () => {
  it('reads account identity without embedding state', async () => {
    const client: HttpClient = {
      request: vi.fn(async () => ({
        body: {
          avatarUrl: '/api/account/avatar',
          displayName: 'Ada Lovelace',
          email: 'ada@example.com',
          offers: ['sign-in', 'retired-offer'],
          signedIn: true,
        },
        status: 200,
      })),
    };
    const account = await createAccountAdapter(client, ORIGIN, noFetch).load(signal);
    expect(account).toEqual({
      avatarUrl: '/api/account/avatar',
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      offers: ['sign-in'],
      signedIn: true,
    });
  });

  it('fetches the picture as bytes from the server origin, and reads a missing one as none', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const fetchRequest = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === `${ORIGIN}/api/account/avatar`
        ? new Response(png, { status: 200 })
        : new Response(null, { status: 404 }),
    );
    const client: HttpClient = { request: noFetch };
    expect((await createAccountAdapter(client, ORIGIN, fetchRequest).avatar(signal))?.size).toBe(
      png.size,
    );

    const missing = createAccountAdapter(
      client,
      ORIGIN,
      async () => new Response(null, { status: 404 }),
    );
    expect(await missing.avatar(signal)).toBeNull();
    const down = createAccountAdapter(client, ORIGIN, async () => {
      throw new Error('offline');
    });
    expect(await down.avatar(signal)).toBeNull();
  });

  it('starts an account-purpose sign-in, never an embedding one, and reads its status', async () => {
    const request = vi.fn(async (input: HttpRequest) =>
      input.path === '/api/account/oauth/start'
        ? {
            body: {
              flowId: 'f1',
              provider: 'google',
              purpose: 'account',
              url: 'https://accounts.example/x',
            },
            status: 200,
          }
        : { body: { state: 'complete' }, status: 200 },
    );
    const api = createAccountAdapter({ request }, ORIGIN, noFetch);
    const started = await api.startSignIn(signal);
    expect(started).toEqual({ flowId: 'f1', url: 'https://accounts.example/x' });
    expect(request).toHaveBeenCalledWith({
      body: { provider: 'google', purpose: 'account' },
      method: 'POST',
      path: '/api/account/oauth/start',
      signal,
    });
    expect((await api.signInStatus('f1', signal)).state).toBe('complete');
  });

  it('gives a failed sign-in a sentence even when the server sent none', async () => {
    const client: HttpClient = {
      request: vi.fn(async () => ({ body: { state: 'error' }, status: 200 })),
    };
    expect(await createAccountAdapter(client, ORIGIN, noFetch).signInStatus('f1', signal)).toEqual({
      error: 'Sign-in failed.',
      state: 'error',
    });
  });

  it('signs out and answers with the signed-out account', async () => {
    const request = vi.fn(async () => ({ body: { signedIn: false }, status: 200 }));
    const account = await createAccountAdapter({ request }, ORIGIN, noFetch).signOut(signal);
    expect(account).toEqual({
      avatarUrl: null,
      displayName: null,
      email: null,
      offers: [],
      signedIn: false,
    });
    expect(request).toHaveBeenCalledWith({ method: 'DELETE', path: '/api/account', signal });
  });

  it('reads an unreachable account service as a capability, not a refusal', async () => {
    const client: HttpClient = {
      request: vi.fn(async () => ({ body: { error: 'down' }, status: 503 })),
    };
    await expect(createAccountAdapter(client, ORIGIN, noFetch).load(signal)).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});

it('uses authenticated proof operations without passing a recipient or accepting a session', async () => {
  const request = vi.fn(async () => ({ body: { success: true }, status: 200 }));
  const api = createAccountAdapter({ request }, ORIGIN, noFetch);
  await api.sendEmailProof(signal);
  await api.verifyEmailProof('123456', signal);
  expect(request).toHaveBeenNthCalledWith(1, {
    method: 'POST',
    path: '/api/account/email-proof',
    body: { action: 'send' },
    signal,
  });
  expect(request).toHaveBeenNthCalledWith(2, {
    method: 'POST',
    path: '/api/account/email-proof',
    body: { action: 'verify', otp: '123456' },
    signal,
  });
});
