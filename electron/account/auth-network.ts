import crypto from 'node:crypto';
import http from 'node:http';
import {
  AUTH_PATHS, AUTH_REQUEST_LIMIT, AUTH_RESPONSE_LIMIT, AUTH_TIMEOUT_MS,
  SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, authNetworkError,
} from '../../shared/hosted-auth-network.ts';

/** A bounded, process-private relay to Chromium's system-proxy-aware session.
 * No renderer IPC, arbitrary destination, redirects, cookies or session storage. */
export async function createAuthNetworkBridge(options: { fetch: typeof fetch }) {
  const token = crypto.randomBytes(32).toString('hex');
  const pending = new Set<AbortController>();
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const supplied = request.headers['x-stashbase-auth-network-token'];
    if (request.headers.origin || typeof supplied !== 'string' || !/^[0-9a-f]{64}$/.test(supplied)
      || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== 'POST' || request.url !== '/') { response.writeHead(404).end(); return; }
    if (pending.size >= 8) { response.writeHead(503).end(); return; }
    const controller = new AbortController();
    pending.add(controller);
    const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), AUTH_TIMEOUT_MS);
    const disconnect = () => { if (!response.writableEnded) controller.abort(); };
    response.on('close', disconnect);
    const abort = () => { if (!response.writableEnded) response.destroy(); };
    // Also bound incomplete request bodies, before an upstream fetch exists.
    controller.signal.addEventListener('abort', abort, { once: true });
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > AUTH_REQUEST_LIMIT) { response.writeHead(413).end(); return; }
        chunks.push(Buffer.from(chunk));
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { response.writeHead(400).end(); return; }
      if (!input || !AUTH_PATHS.has(input.path)
        || (input.body !== undefined && typeof input.body !== 'string')
        || (input.accessToken !== undefined && (typeof input.accessToken !== 'string' || input.accessToken.length > 16_384))) {
        response.writeHead(400).end(); return;
      }
      controller.signal.removeEventListener('abort', abort);
      const upstream = await options.fetch(`${SUPABASE_URL}/auth/v1${input.path}`, {
        method: input.path === '/user' ? 'GET' : 'POST',
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          'content-type': 'application/json',
          'cache-control': 'no-store',
          ...(input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {}),
        },
        ...(input.path !== '/user' ? { body: input.body } : {}),
        credentials: 'omit', redirect: 'error', signal: controller.signal,
      });
      const reader = upstream.body?.getReader();
      const parts: Uint8Array[] = [];
      let length = 0;
      try {
        while (reader) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > AUTH_RESPONSE_LIMIT) throw Object.assign(new Error('Response too large'), { code: 'AUTH_RESPONSE_TOO_LARGE' });
          parts.push(next.value);
        }
      } finally { await reader?.cancel().catch(() => {}); }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: upstream.status, body: Buffer.concat(parts).toString('utf8') }));
    } catch (error) {
      if (!response.destroyed) {
        const failure = authNetworkError(controller.signal.aborted ? controller.signal.reason : error);
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ errorCode: failure.code }));
      }
    } finally {
      clearTimeout(timeout);
      response.removeListener('close', disconnect);
      controller.signal.removeEventListener('abort', abort);
      pending.delete(controller);
    }
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.requestTimeout = AUTH_TIMEOUT_MS;
  server.headersTimeout = AUTH_TIMEOUT_MS;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing authentication relay address');
  return {
    port: address.port, token,
    cancelPending() { for (const controller of pending) controller.abort(); },
    close() {
      for (const controller of pending) controller.abort();
      server.closeAllConnections();
      server.close();
    },
  };
}
