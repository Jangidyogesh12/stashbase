import assert from 'node:assert/strict';
import type { Server as HttpServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import {
  beginHostedOAuth,
  failHostedOAuth,
  hostedOAuthStatus,
} from './hosted-account.ts';
import { mount as mountAccountRoutes } from './routes/account.ts';

test('OAuth app-return proof requires the Electron process-private token', async (t) => {
  const app = express();
  const flow = beginHostedOAuth('google', 'http://127.0.0.1:8090', 'window-one');
  failHostedOAuth(flow.flowId, 'expected test failure');
  mountAccountRoutes(app, { appReturnToken: 'private-return-token' });

  const server: HttpServer = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/account/oauth/app-return`;

  assert.equal((await fetch(url, { method: 'POST' })).status, 403);
  assert.equal(hostedOAuthStatus(flow.flowId).appReturned, undefined);

  const intent = await fetch(
    `http://127.0.0.1:${address.port}/api/account/oauth/return-intent?flow=${flow.flowId}`,
    { method: 'POST' },
  );
  assert.equal(intent.status, 200);

  assert.equal((await fetch(url, {
    method: 'POST',
    headers: { 'x-stashbase-oauth-return-token': 'wrong-token' },
  })).status, 403);
  assert.equal(hostedOAuthStatus(flow.flowId).appReturned, undefined);

  const accepted = await fetch(url, {
    method: 'POST',
    headers: { 'x-stashbase-oauth-return-token': 'private-return-token' },
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { acknowledged: true, windowId: 'window-one' });
  assert.equal(hostedOAuthStatus(flow.flowId).appReturned, true);
});

test('mailbox proof accepts only fixed current-account operations and preserves credentials', async (t) => {
  const config = await import('./app-config.ts');
  const previous = config.getHostedAccountSession();
  const session = { accessToken: 'fixture-access', sessionToken: 'fixture-session', expiresAt: 4102444800, userId: 'owner', email: 'owner@example.test' };
  config.setHostedAccountSession(session);
  t.after(() => config.setHostedAccountSession(previous));
  const nativeFetch = globalThis.fetch;
  const operations: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url).startsWith('http://127.0.0.1:')) return nativeFetch(url, init);
    operations.push(new URL(String(url)).pathname);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-session');
    return Response.json({ success: true });
  });
  const app = express();
  app.use(express.json());
  mountAccountRoutes(app, { appReturnToken: 'fixture-return' });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const post = (body: unknown) => nativeFetch(`http://127.0.0.1:${address.port}/api/account/email-proof`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await post({ action: 'send', email: 'other@example.test' })).status, 400);
  assert.equal((await post({ action: 'verify', otp: 'bad' })).status, 400);
  assert.equal((await post({ action: 'send' })).status, 200);
  assert.equal((await post({ action: 'verify', otp: '123456' })).status, 200);
  assert.deepEqual(operations, ['/api/auth/account/email/send', '/api/auth/account/email/verify']);
  assert.deepEqual(config.getHostedAccountSession(), session);
});
