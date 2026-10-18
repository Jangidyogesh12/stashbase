'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, session } = require('electron');
const { createAuthNetworkBridge } = require('../../dist/electron/account/auth-network.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-auth-network-'));
app.setPath('userData', path.join(root, 'profile'));
let bridge;
let proxy;
let pac;
const timeout = setTimeout(() => app.exit(1), 25_000);
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

app.whenReady().then(async () => {
  const tunnels = [];
  proxy = http.createServer();
  proxy.on('connect', (request, socket) => {
    tunnels.push(request.url);
    // No credentials or requests reach the real Auth service in this smoke.
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
  });
  await listen(proxy);
  const proxyPort = proxy.address().port;
  pac = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/x-ns-proxy-autoconfig');
    response.end(`function FindProxyForURL(url, host) { return "PROXY 127.0.0.1:${proxyPort}"; }`);
  });
  await listen(pac);
  const authSession = session.fromPartition('auth-network-smoke', { cache: false });
  await authSession.setProxy({ mode: 'pac_script', pacScript: `http://127.0.0.1:${pac.address().port}/proxy.pac` });
  bridge = await createAuthNetworkBridge({ fetch: (url, init) => authSession.fetch(url, init) });
  const send = () => fetch(`http://127.0.0.1:${bridge.port}/`, {
    method: 'POST', headers: { 'x-stashbase-auth-network-token': bridge.token },
    body: JSON.stringify({ path: '/token?grant_type=pkce', body: JSON.stringify({ auth_code: 'fixture-only', code_verifier: 'fixture-only' }) }),
  });
  const reply = await send();
  assert.equal(reply.status, 502);
  assert.equal((await reply.json()).errorCode, 'ERR_TUNNEL_CONNECTION_FAILED');
  // Assert the Auth request itself: Chromium can also probe connections through
  // the configured proxy. Relay destination restrictions have their own tests.
  assert.ok(tunnels.includes('vqtfigkoihpuziaimluf.supabase.co:443'),
    `Chromium must send Auth through the PAC-selected proxy; observed ${JSON.stringify(tunnels)}`);
  await authSession.closeAllConnections();
  await new Promise(resolve => proxy.close(resolve));
  await authSession.setProxy({ mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${proxyPort};https=127.0.0.1:${proxyPort}` });
  const unavailable = await send();
  assert.equal(unavailable.status, 502);
  assert.equal((await unavailable.json()).errorCode, 'ERR_PROXY_CONNECTION_FAILED');
  console.log('Auth native smoke passed: PAC CONNECT routing, proxy changes, concrete Chromium failures.');
}).then(() => finish(0), error => { console.error(error); finish(1); });

function finish(code) {
  clearTimeout(timeout);
  bridge?.close();
  proxy?.closeAllConnections(); proxy?.close();
  pac?.closeAllConnections(); pac?.close();
  app.exit(code);
}
