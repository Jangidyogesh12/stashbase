'use strict';

const assert = require('node:assert/strict');

const assetPath = '/asset/__folder/%252Fproject/screenshots/image%20%23%E5%9B%BE.png?v=fixture';
const attachmentPath = '/api/agent/attachment-preview?path=%2Ftmp%2Fstashbase-attachments%2Ffixture%2Fshot.png';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
  'base64',
);

function serveDocumentImageFixture(request, response) {
  if (request.url !== assetPath && request.url !== attachmentPath) return false;
  // Project assets retain path checks without acquiring window authority.
  if (request.url === assetPath) assert.equal(request.headers['x-stashbase-window-id'], undefined);
  response.setHeader('content-type', 'image/png');
  response.end(png);
  return true;
}

async function checkDocumentImage(window, serverOrigin) {
  for (const imagePath of [assetPath, attachmentPath]) {
  const result = await window.webContents.executeJavaScript(`(async () => {
    const url = ${JSON.stringify(serverOrigin + imagePath)};
    const response = await fetch(url);
    const blob = await response.blob();
    const bytes = blob.size;
    const control = new Image();
    const controlUrl = URL.createObjectURL(blob);
    try { control.src = controlUrl; await control.decode(); }
    finally { URL.revokeObjectURL(controlUrl); }
    const violations = [];
    const onViolation = event => violations.push(event.effectiveDirective);
    document.addEventListener('securitypolicyviolation', onViolation);
    const image = new Image();
    image.src = url;
    document.body.append(image);
    try {
      await image.decode();
      return { status: response.status, bytes, width: image.naturalWidth };
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 50));
      throw new Error(JSON.stringify({ status: response.status, bytes,
        error: error.message, violations }));
    } finally {
      image.remove();
      document.removeEventListener('securitypolicyviolation', onViolation);
    }
  })()`);
  assert.deepEqual(result, { status: 200, bytes: png.length, width: 1 });
  }
  console.log('real Electron project and attachment image decoding passed');
}

module.exports = { serveDocumentImageFixture, checkDocumentImage };
