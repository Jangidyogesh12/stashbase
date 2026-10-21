import http from 'node:http';
import {
  AUTH_PATHS, AUTH_REQUEST_LIMIT, AUTH_RESPONSE_LIMIT, AUTH_TIMEOUT_MS,
  AUTH_BASE_URL, authMethod, authNetworkError,
} from '../shared/hosted-auth-network.ts';

/** Desktop auth uses Chromium via a private loopback relay. Standalone Node
 * development retains fetch; an unavailable desktop relay never falls back to
 * direct traffic. Node HTTP keeps the local hop outside any ambient proxy. */
export function createHostedAuthRequest(bridge: { port?: string; token?: string; required: boolean }) {
  return async function hostedAuthRequest(path: string, options: {
    body?: Record<string, unknown>; accessToken?: string; signal: AbortSignal;
  }): Promise<Response> {
    if (!AUTH_PATHS.has(path)) throw new Error('Unsupported authentication operation');
    try {
      const port = Number(bridge.port);
      const token = bridge.token;
      if (!port && !token && !bridge.required) {
        return await fetch(`${AUTH_BASE_URL}${path}`, {
          method: authMethod(path),
          headers: { 'content-type': 'application/json',
            ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}) },
          ...(authMethod(path) === 'POST' && options.body ? { body: JSON.stringify(options.body) } : {}),
          signal: options.signal, redirect: 'error', credentials: 'omit',
        });
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) {
        throw { code: 'AUTH_BRIDGE_UNAVAILABLE' };
      }
      const body = JSON.stringify({ path, body: options.body ? JSON.stringify(options.body) : undefined, accessToken: options.accessToken });
      if (Buffer.byteLength(body) > AUTH_REQUEST_LIMIT) throw { code: 'AUTH_REQUEST_TOO_LARGE' };
      return await new Promise<Response>((resolve, reject) => {
        const request = http.request({
          hostname: '127.0.0.1', port, path: '/', method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
            'x-stashbase-auth-network-token': token },
          signal: options.signal,
        }, response => {
          const parts: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            // The JSON envelope may escape every character in the upstream body.
            if (size > AUTH_RESPONSE_LIMIT * 6 + 1024) { request.destroy(); reject({ code: 'AUTH_RESPONSE_TOO_LARGE' }); }
            else parts.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () => {
            try {
              if (response.statusCode !== 200 && response.statusCode !== 502) throw { code: 'AUTH_BRIDGE_UNAVAILABLE' };
              const reply = JSON.parse(Buffer.concat(parts).toString('utf8'));
              if (response.statusCode === 502) throw { code: reply.errorCode };
              if (!Number.isInteger(reply.status) || reply.status < 200 || reply.status > 599 || typeof reply.body !== 'string') throw { code: 'AUTH_BRIDGE_UNAVAILABLE' };
              resolve(new Response([204, 205, 304].includes(reply.status) ? null : reply.body, {
                status: reply.status, headers: { 'content-type': 'application/json' },
              }));
            } catch (error) { reject(error); }
          });
        });
        const timeout = setTimeout(() => request.destroy(Object.assign(new Error('Timed out'), { code: 'ETIMEDOUT' })), AUTH_TIMEOUT_MS + 1000);
        request.once('close', () => clearTimeout(timeout));
        request.once('error', reject);
        request.end(body);
      });
    } catch (error) {
      const detail = authNetworkError(options.signal.aborted ? options.signal.reason : error);
      const stage = path === '/electron/token' ? 'exchange the sign-in code' : path === '/token' ? 'refresh the sign-in session' : path === '/get-session' ? 'read the signed-in profile' : 'sign out';
      throw Object.assign(new Error(`Could not ${stage} with ${new URL(AUTH_BASE_URL).hostname}. ${detail.message}`, { cause: detail }), { code: detail.code });
    }
  };
}

export const hostedAuthRequest = createHostedAuthRequest({
  port: process.env.STASHBASE_AUTH_NETWORK_PORT,
  token: process.env.STASHBASE_AUTH_NETWORK_TOKEN,
  required: process.env.STASHBASE_PACKAGED === '1' || Boolean(process.env.STASHBASE_SERVER_INSTANCE_ID),
});
// Do not pass the process-private capability to Agent or tool subprocesses.
delete process.env.STASHBASE_AUTH_NETWORK_PORT;
delete process.env.STASHBASE_AUTH_NETWORK_TOKEN;
