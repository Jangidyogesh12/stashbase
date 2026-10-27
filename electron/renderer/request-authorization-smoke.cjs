'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, net, protocol, session } = require('electron');
const { WebSocketServer } = require('ws');
const { APP_ORIGIN, installAppProtocol, registerAppScheme } = require('../app-protocol.cjs');
const { applicationWindowWebPreferences, secureApplicationWindow } = require('../window-security.cjs');
const { installRequestAuthorization } = require('./requests.cjs');

const root = process.env.STASHBASE_SMOKE_ROOT;
if (!root) throw new Error('Launch this fixture through smoke-runner.cjs.');
app.setPath('userData', path.join(root, 'profile'));
fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><body>Request boundary fixture</body>');
registerAppScheme(protocol);
const requests = [];
const upgrades = [];
const sockets = new WebSocketServer({ noServer: true });
const { createRendererOriginPolicy } = require(path.join(root, 'renderer-origin.cjs'));
const requestApp = require('express')();
const origins = new Set([APP_ORIGIN]);
requestApp.use(createRendererOriginPolicy(origins));
let fontRequest;
let cacheProbeRequests = 0;
requestApp.use((request, response) => {
  // Deliberately accept all path spellings: the real Express router is case
  // insensitive too. The assertion is that denied requests never arrive here.
  if (request.path === '/api/cache-probe') {
    cacheProbeRequests++;
    if (cacheProbeRequests === 1) response.status(304).end();
    else response.json({ value: 'live-settings' });
    return;
  }
  if (request.path === '/asset/__folder/fixture/font.woff2') {
    fontRequest = { origin: request.headers.origin, windowId: request.headers['x-stashbase-window-id'] ?? null };
    response.setHeader('content-type', 'font/woff2');
    response.end(fs.readFileSync(require.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
      { paths: [path.resolve(__dirname, '../../renderer')] })));
    return;
  }
  if (request.path === '/asset/__folder/fixture/preview.html') {
    response.setHeader('content-type', 'text/html');
    response.end(`<!doctype html><body><script>
      (async () => {
        try {
          const font = await new FontFace('Fixture', 'url(font.woff2)').load();
          document.fonts.add(font);
          const api = await fetch('/api/probe').then(() => 'allowed', () => 'blocked');
          parent.postMessage({ fixture: 'font', status: font.status, api }, '*');
        } catch (error) { parent.postMessage({ fixture: 'font', error: String(error) }, '*'); }
      })();
    </script></body>`);
    return;
  }
  if (request.url === '/') {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><body>Vite origin fixture</body>');
    return;
  }
  requests.push({ url: request.url, windowId: request.headers['x-stashbase-window-id'] ?? null });
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(requests.at(-1)));
});
const server = http.createServer(requestApp);
server.on('upgrade', (request, socket, head) => {
  upgrades.push({ url: request.url, windowId: request.headers['x-stashbase-window-id'] ?? null });
  sockets.handleUpgrade(request, socket, head, (ws) => {
    ws.send(JSON.stringify(upgrades.at(-1)));
  });
});
const timeout = setTimeout(() => { console.error('request authorization smoke timed out'); app.exit(1); }, 20_000);

async function probeWindow(window, origin) {
  return window.webContents.executeJavaScript(`(async () => {
    const origin = ${JSON.stringify(origin)};
    const fetchPath = async (path) => {
      try { return await (await fetch(origin + path)).json(); }
      catch { return 'blocked'; }
    };
    const socketPath = (path) => new Promise((resolve) => {
      const socket = new WebSocket(origin.replace('http:', 'ws:') + path);
      // This checks authorization, not a two-second loopback latency budget.
      // Hosted Windows can delay Chromium delivery while starting its services.
      const timer = setTimeout(() => { socket.close(); resolve('timeout'); }, 5000);
      socket.onerror = () => { clearTimeout(timer); resolve('blocked'); };
      socket.onmessage = (event) => { clearTimeout(timer); socket.close(); resolve(JSON.parse(event.data)); };
    });
    return {
      api: await fetchPath('/api/probe?windowId=forged'),
      upper: await fetchPath('/API/probe?windowId=forged'),
      mixed: await fetchPath('/Api/probe?windowId=forged'),
      agent: await socketPath('/ws/agent?agent=codex'),
      legacy: await socketPath('/ws/codex'),
      suffix: await socketPath('/ws/agent-extra'),
      resource: await fetchPath('/pdfjs-assets/wasm/fixture'),
      asset: await fetchPath('/asset/__folder/fixture/document'),
      static: await fetchPath('/@vite/client'),
      hmr: await socketPath('/?token=fixture'),
    };
  })()`);
}

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverOrigin = `http://127.0.0.1:${server.address().port}`;
  origins.add(serverOrigin);
  installAppProtocol({ protocol, net, rendererRoot: root, serverOrigin });
  const window = new BrowserWindow({ show: false, webPreferences: applicationWindowWebPreferences({}) });
  const unregistered = new BrowserWindow({ show: false, webPreferences: applicationWindowWebPreferences({}) });
  installRequestAuthorization({
    rendererOrigins: new Set([APP_ORIGIN]), serverOrigin, session: session.defaultSession,
    windowRegistrationForWebContentsId: (id) => id === window.webContents.id
      ? { windowId: 'registered-window', window } : null,
  });
  for (const candidate of [window, unregistered]) {
    secureApplicationWindow(candidate, APP_ORIGIN);
    await candidate.loadURL(`${APP_ORIGIN}/`);
  }
  const live = await probeWindow(window, serverOrigin);
  const denied = await probeWindow(unregistered, serverOrigin);
  assert.deepEqual(live.api, { url: '/api/probe?windowId=forged', windowId: 'registered-window' });
  assert.deepEqual(live.agent, { url: '/ws/agent?agent=codex', windowId: 'registered-window' });
  for (const result of [live, denied]) {
    assert.equal(result.upper, 'blocked');
    assert.equal(result.mixed, 'blocked');
    assert.equal(result.legacy, 'blocked');
    assert.equal(result.suffix, 'blocked');
    assert.equal(result.static, 'blocked');
    assert.equal(result.hmr, 'blocked');
    assert.deepEqual(result.resource, { url: '/pdfjs-assets/wasm/fixture', windowId: null });
    assert.deepEqual(result.asset, { url: '/asset/__folder/fixture/document', windowId: null });
  }
  assert.equal(denied.api, 'blocked');
  assert.equal(denied.agent, 'blocked');
  const preview = await window.webContents.executeJavaScript(`new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-scripts';
    frame.src = ${JSON.stringify(serverOrigin + '/asset/__folder/fixture/preview.html')};
    const listener = event => {
      if (event.source !== frame.contentWindow || event.data.fixture !== 'font') return;
      window.removeEventListener('message', listener);
      frame.remove();
      resolve({ ...event.data, origin: event.origin });
    };
    window.addEventListener('message', listener);
    document.body.append(frame);
  })`);
  assert.deepEqual(preview, { fixture: 'font', status: 'loaded', api: 'blocked', origin: 'null' });
  assert.deepEqual(fontRequest, { origin: 'null', windowId: null });
  assert.equal(requests.filter((request) => /\/api\//iu.test(request.url)).length, 1);
  assert.deepEqual(upgrades, [{ url: '/ws/agent?agent=codex', windowId: 'registered-window' }]);
  const cacheRecovery = await window.webContents.executeJavaScript(
    fs.readFileSync(path.join(root, 'http-client.js'), 'utf8') + `;
    (async () => {
      const errors = [];
      const client = FixtureHttp.createHttpClient(${JSON.stringify(serverOrigin)}, fetch, error => errors.push(error.message));
      const first = await client.request({ path: '/api/cache-probe' });
      const second = await client.request({ path: '/api/cache-probe' });
      return { statuses: [first.status, second.status], values: [first.body, second.body], errors };
    })()`);
  assert.deepEqual(cacheRecovery, { statuses: [200, 200], values: [{ value: 'live-settings' }, { value: 'live-settings' }], errors: [] });
  assert.equal(cacheProbeRequests, 3);
  console.log('real Electron API reads recover a bare 304 and bypass stale HTTP cache');
  const viteWindow = new BrowserWindow({ show: false, webPreferences: applicationWindowWebPreferences({}) });
  installRequestAuthorization({
    rendererOrigins: new Set([serverOrigin]), serverOrigin, session: session.defaultSession,
    windowRegistrationForWebContentsId: (id) => id === viteWindow.webContents.id
      ? { windowId: 'vite-window', window: viteWindow } : null,
  });
  secureApplicationWindow(viteWindow, serverOrigin);
  await viteWindow.loadURL(`${serverOrigin}/`);
  const vite = await probeWindow(viteWindow, serverOrigin);
  assert.equal(vite.api.windowId, 'vite-window');
  assert.equal(vite.agent.windowId, 'vite-window');
  assert.deepEqual(vite.static, { url: '/@vite/client', windowId: null });
  assert.deepEqual(vite.hmr, { url: '/?token=fixture', windowId: 'vite-window' });
  for (const key of ['upper', 'mixed', 'legacy', 'suffix']) assert.equal(vite[key], 'blocked');
  console.log('real Electron HTTP/WS authorization smoke passed (application and Vite origins)');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  for (const socket of sockets.clients) socket.terminate();
  sockets.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  app.exit(process.exitCode || 0);
});
