'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ORIGIN = 'app://renderer';
const APP_URL = `${APP_ORIGIN}/`;

function registerAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

function productionContentSecurityPolicy(serverOrigin) {
  const websocketOrigin = serverOrigin.replace(/^http:/u, 'ws:').replace(/^https:/u, 'wss:');
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-src ${serverOrigin}/asset/ ${serverOrigin}/asset-derived/`,
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${serverOrigin}/asset/ ${serverOrigin}/api/gallery/image ${serverOrigin}/api/agent/attachment-preview`,
    `media-src 'self' blob: ${serverOrigin}`,
    `connect-src 'self' ${serverOrigin} ${websocketOrigin}`,
    "worker-src 'self' blob:",
  ].join('; ');
}

function response(status, body, contentSecurityPolicy, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      ...headers,
      'content-security-policy': contentSecurityPolicy,
      'x-content-type-options': 'nosniff',
    },
  });
}

function assetPathFromRequest(rawUrl, rendererRoot) {
  if (/%(?:2e|2f|5c)/iu.test(rawUrl)) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'app:'
    || url.hostname !== 'renderer'
    || url.username
    || url.password
    || url.port
  ) {
    return null;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\\') || decoded.includes('\0')) return null;
  const relative = decoded.replace(/^\/+/, '') || 'index.html';
  const resolvedRoot = path.resolve(rendererRoot);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return resolved;
}

function installAppProtocol({ protocol, net, rendererRoot, serverOrigin }) {
  const contentSecurityPolicy = productionContentSecurityPolicy(serverOrigin);
  protocol.handle('app', async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return response(405, null, contentSecurityPolicy, { allow: 'GET, HEAD' });
    }
    const assetPath = assetPathFromRequest(request.url, rendererRoot);
    if (!assetPath) return response(404, null, contentSecurityPolicy);
    try {
      const assetResponse = await net.fetch(pathToFileURL(assetPath).toString());
      const headers = Object.fromEntries(assetResponse.headers.entries());
      return response(
        assetResponse.status,
        request.method === 'HEAD' ? null : assetResponse.body,
        contentSecurityPolicy,
        headers,
      );
    } catch {
      return response(404, null, contentSecurityPolicy);
    }
  });
}

module.exports = {
  APP_ORIGIN,
  APP_URL,
  assetPathFromRequest,
  installAppProtocol,
  productionContentSecurityPolicy,
  registerAppScheme,
};
