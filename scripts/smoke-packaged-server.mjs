import { smokeDaemon } from './packaging/smoke-daemon.mjs';
import { createExtractorRuntime } from '../server/extractor-runtime.ts';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpencodeClient } from '@opencode-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release.nosync');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const productName = pkg.build?.productName || pkg.name;

function argValue(name) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  return null;
}

function findPackagedApp() {
  const explicit = argValue('--app');
  if (explicit) return path.resolve(explicit);

  const candidates = packagedAppCandidates();
  const hit = candidates.find((candidate) => fs.existsSync(candidate));
  if (hit) return hit;

  throw new Error(
    `No packaged ${productName} app found. Run the matching \`pnpm dist:*\` command or pass --app=/path/to/app.`,
  );
}

function packagedAppCandidates() {
  if (process.platform === 'darwin') {
    return [
      path.join(releaseDir, process.arch === 'arm64' ? 'mac-arm64' : 'mac', `${productName}.app`),
    ];
  }
  if (process.platform === 'win32') {
    return [
      path.join(releaseDir, 'win-unpacked'),
      path.join(releaseDir, 'win-ia32-unpacked'),
      path.join(releaseDir, 'win-arm64-unpacked'),
    ];
  }
  if (process.platform === 'linux') {
    return [
      path.join(releaseDir, 'linux-unpacked'),
    ];
  }
  throw new Error(`Unsupported packaged smoke platform: ${process.platform}`);
}

function packagedLayout(appPath) {
  if (process.platform === 'darwin') {
    const resourcesPath = path.join(appPath, 'Contents', 'Resources');
    return {
      appRoot: path.join(resourcesPath, 'app.asar'),
      electronBin: path.join(appPath, 'Contents', 'MacOS', productName),
      resourcesPath,
    };
  }
  if (process.platform === 'win32') {
    const resourcesPath = path.join(appPath, 'resources');
    return {
      appRoot: path.join(resourcesPath, 'app.asar'),
      electronBin: path.join(appPath, `${productName}.exe`),
      resourcesPath,
    };
  }
  const resourcesPath = path.join(appPath, 'resources');
  return {
    appRoot: path.join(resourcesPath, 'app.asar'),
    electronBin: findLinuxElectronBin(appPath),
    resourcesPath,
  };
}

function findLinuxElectronBin(appPath) {
  const candidates = [
    path.join(appPath, productName),
    path.join(appPath, pkg.name),
    path.join(appPath, String(productName).toLowerCase()),
    path.join(appPath, String(pkg.name).toLowerCase()),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function requestJson(port, requestPath, timeoutMs, options = {}) {
  return new Promise((resolve) => {
    const body = options.body == null ? undefined : JSON.stringify(options.body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method: options.method ?? 'GET',
        timeout: timeoutMs,
        headers: {
          ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
          ...(options.headers ?? {}),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < 8192) body += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ ok: true, statusCode: res.statusCode ?? 0, body: JSON.parse(body) });
          } catch {
            resolve({ ok: true, statusCode: res.statusCode ?? 0, body: null });
          }
        });
      },
    );
    req.on('error', () => resolve({ ok: false, statusCode: 0, body: null }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, body: null });
    });
    if (body) req.write(body);
    req.end();
  });
}

function requestText(port, requestPath, timeoutMs, options = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method: options.method ?? 'GET',
        timeout: timeoutMs,
        headers: options.headers ?? {},
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({
          ok: true,
          statusCode: res.statusCode ?? 0,
          body,
        }));
      },
    );
    req.on('error', () => resolve({ ok: false, statusCode: 0, body: '' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, body: '' });
    });
    req.end();
  });
}

function requestBytes(port, requestPath, timeoutMs, options = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method: options.method ?? 'GET',
        timeout: timeoutMs,
        headers: options.headers ?? {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({
          ok: true,
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }));
      },
    );
    req.on('error', () => resolve({ ok: false, statusCode: 0, headers: {}, body: Buffer.alloc(0) }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, headers: {}, body: Buffer.alloc(0) });
    });
    req.end();
  });
}

async function requestOk(port, timeoutMs) {
  const res = await requestJson(port, '/api/folder', timeoutMs);
  return res.ok && res.statusCode >= 200 && res.statusCode < 500;
}

async function requestApi(port, method, requestPath, body) {
  const res = await requestJson(port, requestPath, 5_000, {
    method,
    body,
    headers: { 'x-stashbase-window-id': 'packaged-smoke' },
  });
  if (!res.ok || res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`${method} ${requestPath} failed: status=${res.statusCode} body=${JSON.stringify(res.body)}`);
  }
  return res.body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sidecarCandidates(root, name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const base = path.join(root, 'python', 'sidecar');
  return [
    path.join(base, name, exe),
    path.join(base, exe),
  ];
}

function findSidecarExecutable(root, name) {
  return sidecarCandidates(root, name).find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) ?? sidecarCandidates(root, name)[0];
}

function findPackagedOpenCode(resourcesPath) {
  return path.join(resourcesPath, 'opencode', 'opencode.exe');
}

async function checkPdfResources(port) {
  // PDF JavaScript is already bundled into the renderer. These resources are
  // fetched at runtime and must survive removal of pdfjs-dist's duplicate builds.
  for (const [directory, file] of [
    ['cmaps', 'Adobe-Japan1-UCS2.bcmap'],
    ['standard_fonts', 'LiberationSans-Regular.ttf'],
    ['wasm', 'openjpeg.wasm'],
  ]) {
    const response = await requestBytes(port, `/pdfjs-assets/${directory}/${file}`, 5_000);
    if (!response.ok || response.statusCode !== 200 || response.body.length === 0) {
      throw new Error(`Packaged PDF resource unavailable: ${directory}/${file}`);
    }
  }
  console.log('[smoke] packaged PDF fonts, CMaps and WASM are available');
}

async function waitForServer(port, child, output) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) break;
    if (await requestOk(port, 250)) return;
    await sleep(150);
  }

  const tail = output.join('').slice(-8_000);
  throw new Error(`Packaged server did not respond on :${port} within 10s.\n${tail}`);
}

function assertFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
}

async function assertPackagedHealth(port, expected) {
  const res = await requestJson(port, '/api/health', 1000);
  if (!res.ok || res.statusCode !== 200 || !res.body || typeof res.body !== 'object') {
    throw new Error(`packaged health probe failed: status=${res.statusCode}`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (res.body[key] !== value) {
      throw new Error(
        `packaged health ${key} mismatch:\n` +
          `  expected: ${value}\n` +
          `  actual: ${res.body[key]}`,
      );
    }
  }
}

async function assertPackagedRendererWorkers(port) {
  const page = await requestText(port, '/', 5_000);
  const entryPath = page.body.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  if (!page.ok || page.statusCode !== 200 || !entryPath) {
    throw new Error(`packaged renderer entry is unavailable: status=${page.statusCode}`);
  }
  const entry = await requestText(port, entryPath, 5_000);
  if (!entry.ok || entry.statusCode !== 200) {
    throw new Error(`packaged renderer entry is unavailable: status=${entry.statusCode}`);
  }

  const workerPattern = /\bdocx(?:Preview|-preview)\.worker-[A-Za-z0-9_-]+\.js\b/i;
  let workerName = entry.body.match(workerPattern)?.[0];
  if (!workerName) {
    const docxChunkName = entry.body.match(/\bDocxPreview-[A-Za-z0-9_-]+\.js\b/)?.[0];
    if (!docxChunkName) {
      throw new Error('packaged renderer does not reference the DOCX preview chunk');
    }
    const docxChunk = await requestText(port, `/assets/${docxChunkName}`, 5_000);
    workerName = docxChunk.body.match(workerPattern)?.[0];
    if (!docxChunk.ok || docxChunk.statusCode !== 200 || !workerName) {
      throw new Error(`packaged DOCX preview chunk does not reference its worker: status=${docxChunk.statusCode}`);
    }
  }
  let worker = await requestText(port, `/assets/${workerName}`, 5_000);
  if (worker.ok && worker.statusCode === 200 && !/convertToHtml/.test(worker.body)) {
    const nestedWorkerName = worker.body.match(workerPattern)?.[0];
    if (nestedWorkerName && nestedWorkerName !== workerName) {
      workerName = nestedWorkerName;
      worker = await requestText(port, `/assets/${workerName}`, 5_000);
    }
  }
  if (!worker.ok || worker.statusCode !== 200 || !/convertToHtml/.test(worker.body)) {
    throw new Error(`packaged DOCX renderer worker is unavailable: status=${worker.statusCode}`);
  }
  console.log('[smoke] packaged renderer serves the DOCX worker asset from app.asar');
}

async function assertPackagedUserFlow(port, home) {
  const folderRoot = path.join(home, 'User Yuan Li', 'Documents', 'StashBase Demo');
  fs.mkdirSync(path.join(folderRoot, '项目 A', '子目录'), { recursive: true });
  fs.writeFileSync(path.join(folderRoot, 'README Windows.md'), '# Hello Windows\n\nkeyword-one body\n', 'utf8');
  fs.writeFileSync(path.join(folderRoot, '项目 A', '测试 file.md'), '# Nested Note\n\nkeyword-two nested\n', 'utf8');
  fs.writeFileSync(path.join(folderRoot, 'page with space.html'), '<h1>HTML Test</h1> keyword-one', 'utf8');
  fs.writeFileSync(path.join(folderRoot, '项目 A', '子目录', 'deep.md'), '# Deep\n\nkeyword-three\n', 'utf8');
  writeDocxFixture(path.join(folderRoot, 'report smoke.docx'));

  const opened = await requestApi(port, 'POST', '/api/projects/open', { path: folderRoot });
  if (opened?.current?.name !== 'StashBase Demo') {
    throw new Error(`open folder returned unexpected payload: ${JSON.stringify(opened)}`);
  }

  const listing = await requestApi(port, 'GET', '/api/files');
  const files = (listing?.files ?? []).map((file) => file.name).sort();
  const folders = (listing?.folders ?? []).map((folder) => folder.path).sort();
  const expectedFiles = ['README Windows.md', 'page with space.html', 'report smoke.docx', '项目 A/测试 file.md', '项目 A/子目录/deep.md'];
  for (const expected of expectedFiles) {
    if (!files.includes(expected)) throw new Error(`file listing missing ${expected}: ${JSON.stringify(listing)}`);
  }
  for (const expected of ['项目 A', '项目 A/子目录']) {
    if (!folders.includes(expected)) throw new Error(`folder listing missing ${expected}: ${JSON.stringify(listing)}`);
  }

  const nested = await requestApi(port, 'GET', `/api/files/${encodePath('项目 A/测试 file.md')}`);
  if (!/Nested Note/.test(nested?.content ?? '')) throw new Error(`nested file read failed: ${JSON.stringify(nested)}`);

  const html = await requestApi(port, 'GET', `/api/files/${encodePath('page with space.html')}`);
  if (html?.format !== 'html') throw new Error(`HTML file read failed: ${JSON.stringify(html)}`);

  await requestApi(port, 'POST', '/api/files/prepare', { path: 'report smoke.docx' });
  const derivedUrl = `/asset-derived/__window/packaged-smoke/${encodePath('report smoke.docx')}`;
  const docxDeadline = Date.now() + 20_000;
  let docxPreview = null;
  while (Date.now() < docxDeadline) {
    docxPreview = await requestText(port, derivedUrl, 2_000);
    if (docxPreview.ok && docxPreview.statusCode === 200) break;
    if (docxPreview.statusCode !== 409) {
      throw new Error(`packaged DOCX preview failed: status=${docxPreview.statusCode} body=${docxPreview.body.slice(0, 1_000)}`);
    }
    await sleep(100);
  }
  if (!docxPreview?.ok || docxPreview.statusCode !== 200) {
    const conversionStatus = await requestApi(port, 'GET', '/api/index-status');
    throw new Error(`packaged DOCX conversion did not finish: ${JSON.stringify(conversionStatus)}`);
  }
  if (!/Hello StashBase DOCX smoke/.test(docxPreview.body)) {
    throw new Error(`packaged DOCX preview lost fixture content: ${docxPreview.body.slice(0, 1_000)}`);
  }
  if (!/stashbase-docx-conversion: complete/.test(docxPreview.body)) {
    throw new Error('packaged DOCX preview is missing the durable completion marker');
  }
  if (/\son[a-z]+\s*=/i.test(docxPreview.body)) {
    throw new Error('packaged DOCX preview contains an inline event handler');
  }
  console.log('[smoke] packaged DOCX worker converted a fixture from app.asar');


  await requestApi(port, 'POST', '/api/folders', { path: 'New Folder' });
  const created = await requestApi(port, 'POST', '/api/files', {
    name: 'draft windows',
    dir: 'New Folder',
    content: '# Draft\n\nkeyword-four',
  });
  if (created?.name !== 'New Folder/draft windows.md') {
    throw new Error(`create note returned unexpected name: ${JSON.stringify(created)}`);
  }

  const renamed = await requestApi(port, 'PATCH', `/api/files/${encodePath(created.name)}`, {
    new_name: 'renamed windows.md',
    cascade: false,
    async_index: true,
  });
  if (renamed?.name !== 'New Folder/renamed windows.md') {
    throw new Error(`basename rename did not preserve parent folder: ${JSON.stringify(renamed)}`);
  }

  const moved = await requestApi(port, 'PATCH', `/api/files/${encodePath(renamed.name)}`, {
    new_name: '项目 A/moved windows.md',
    cascade: false,
    async_index: true,
  });
  if (moved?.name !== '项目 A/moved windows.md') {
    throw new Error(`full-path move returned unexpected name: ${JSON.stringify(moved)}`);
  }

  const movedBody = await requestApi(port, 'GET', `/api/files/${encodePath('项目 A/moved windows.md')}`);
  if (!/keyword-four/.test(movedBody?.content ?? '')) throw new Error(`moved file read failed: ${JSON.stringify(movedBody)}`);

  const keyword = await requestApi(port, 'GET', '/api/keyword-search?q=keyword-one');
  if ((keyword?.totalMatches ?? 0) < 2) throw new Error(`keyword search missed fixture content: ${JSON.stringify(keyword)}`);

  const status = await requestApi(port, 'GET', '/api/index-status');
  if (typeof status?.treeVersion !== 'number') throw new Error(`index status missing treeVersion: ${JSON.stringify(status)}`);

  const sync = await requestApi(port, 'POST', '/api/sync');
  if (!sync || !Array.isArray(sync.failed)) throw new Error(`sync returned unexpected payload: ${JSON.stringify(sync)}`);

  await requestApi(port, 'DELETE', `/api/files/${encodePath('项目 A/moved windows.md')}`);
  await requestApi(port, 'DELETE', `/api/folders/${encodePath('New Folder')}`);
  console.log('[smoke] packaged user file flow passed');
}

function writeDocxFixture(file) {
  const docxBase64 = [
    'UEsDBBQAAAAIAKaK8VzXeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMEFAAAAAgAporxXCAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMEFAAAAAgAporxXBosGbe8AAAA8wAAABEAAAB3b3JkL2RvY3VtZW50LnhtbDWOQWvDMAyF7/kVwvfV6Q5jhMSFtozdNlgHu3q22oTaUrC8Zf33tQO7fNLTQ0/qd38xwC8mmZgGtd20CpAc+4kug/o8vTw8K5BsydvAhIO6oaidafql8+x+IlKGkkDSLYMac547rcWNGK1seEYq3plTtLnIdNELJz8ndihSDsSgH9v2SUc7kTINQEn9Zn8zpc4VqSKbVwyB4SNbGfdWEI5vhy+QyFfsdfUr08p1S9Dl96TXwRrX1O7/XXMHUEsBAhQDFAAAAAgAporxXNd5hOrxAAAAuAEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACACmivFcIBuG6rIAAAAuAQAACwAAAAAAAAAAAAAAgAEiAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACACmivFcGiwZt7wAAADzAAAAEQAAAAAAAAAAAAAAgAH9AQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAA6AIAAAAA',
  ].join('');
  fs.writeFileSync(file, Buffer.from(docxBase64, 'base64'));
}

function writeTinyPdf(file) {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '5 0 obj\n<< /Length 51 >>\nstream\nBT /F1 18 Tf 40 80 Td (Hello StashBase PDF smoke) Tj ET\nendstream\nendobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += obj;
  }
  const xref = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, body);
}


function writeOcrFixture(file) {
  const pngBase64 = [
    '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',
  ].join('');
  fs.writeFileSync(file, Buffer.from(pngBase64, 'base64'));
}

function runProcess(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(command)} timed out`));
    }, options.timeoutMs ?? 10_000);
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk) => { out += chunk.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output: out });
    });
  });
}

async function smokePackagedOpenCode(openCodeBin) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-packaged-opencode-'));
  const gateway = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain the request before replying. */ }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const base = {
      id: 'chatcmpl-stashbase-packaged-smoke',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'stashbase-agent-default',
    };
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: { role: 'assistant', content: 'probe ok' }, finish_reason: null }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise((resolve, reject) => {
    gateway.once('error', reject);
    gateway.listen(0, '127.0.0.1', resolve);
  });
  const gatewayAddress = gateway.address();
  if (!gatewayAddress || typeof gatewayAddress === 'string') throw new Error('OpenCode smoke gateway has no port');

  const portProbe = http.createServer();
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  const serverAddress = portProbe.address();
  if (!serverAddress || typeof serverAddress === 'string') throw new Error('OpenCode smoke server has no port');
  const serverPort = serverAddress.port;
  await new Promise((resolve) => portProbe.close(resolve));

  const username = 'stashbase';
  const password = 'packaged-smoke-secret';
  const model = 'stashbase-agent-default';
  const config = {
    autoupdate: false,
    share: 'disabled',
    enabled_providers: ['stashbase'],
    model: `stashbase/${model}`,
    provider: {
      stashbase: {
        name: 'StashBase packaged smoke',
        npm: '@ai-sdk/openai-compatible',
        options: {
          apiKey: 'fake-loopback-key',
          baseURL: `http://127.0.0.1:${gatewayAddress.port}/v1`,
          timeout: false,
        },
        models: { [model]: { name: 'Packaged smoke', tool_call: true, reasoning: true } },
      },
    },
    agent: { 'stashbase-smoke': { mode: 'primary' } },
  };
  const child = spawn(openCodeBin, [
    'serve', '--hostname=127.0.0.1', `--port=${serverPort}`, '--pure', '--log-level=WARN',
  ], {
    env: {
      ...process.env,
      HOME: temporaryRoot,
      USERPROFILE: temporaryRoot,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_SERVER_USERNAME: username,
      OPENCODE_SERVER_PASSWORD: password,
      XDG_DATA_HOME: path.join(temporaryRoot, 'data'),
      XDG_CONFIG_HOME: path.join(temporaryRoot, 'config'),
      XDG_CACHE_HOME: path.join(temporaryRoot, 'cache'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`OpenCode startup timed out\n${output.slice(-4_000)}`)), 15_000);
      const inspect = () => {
        if (!output.includes('opencode server listening')) return;
        clearTimeout(timer);
        resolve();
      };
      child.stdout.on('data', inspect);
      child.stderr.on('data', inspect);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`OpenCode exited during startup (${code ?? signal})\n${output.slice(-4_000)}`));
      });
    });
    const client = createOpencodeClient({
      baseUrl: `http://127.0.0.1:${serverPort}`,
      directory: temporaryRoot,
      headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
      throwOnError: true,
    });
    const session = (await client.session.create({ throwOnError: true, body: { title: 'Packaged Smoke' } })).data;
    const response = (await client.session.prompt({
      throwOnError: true,
      path: { id: session.id },
      body: {
        model: { providerID: 'stashbase', modelID: model },
        agent: 'stashbase-smoke',
        parts: [{ type: 'text', text: 'Reply with probe ok.' }],
      },
    })).data;
    const text = response.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    if (text !== 'probe ok') throw new Error(`unexpected packaged OpenCode response: ${JSON.stringify(text)}`);
    await sleep(250);
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(`packaged OpenCode exited unexpectedly (${child.exitCode ?? child.signalCode})`);
    }
    console.log('[smoke] packaged OpenCode completed a model turn and stayed alive');
  } finally {
    if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
    if (child.exitCode == null && child.signalCode == null) {
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await new Promise((resolve) => gateway.close(resolve));
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function smokeElectronMainDependencies(electronBin, appRoot, resourcesPath) {
  const entry = path.join(appRoot, 'electron', 'multi-window.cjs');
  const probe = await runProcess(
    electronBin,
    ['-e', "require(process.argv[1])", entry],
    {
      cwd: resourcesPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: 10_000,
    },
  );
  if (probe.code !== 0) {
    throw new Error(
      `packaged Electron main dependency load failed: exit=${probe.code}\n${probe.output.slice(-4_000)}`,
    );
  }
  console.log('[smoke] packaged Electron main dependencies load from app.asar');
}

async function smokeOcrExtractor(extractBin) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-smoke-ocr-'));
  try {
    const image = path.join(tmp, 'smoke.png');
    const out = path.join(tmp, '.smoke.md');
    writeOcrFixture(image);
    const probe = await runProcess(extractBin, ['ocr', image, out], { timeoutMs: 120_000 });
    if (probe.code !== 0) {
      throw new Error(`ocr extractor failed: exit=${probe.code}\n${probe.output.slice(-4_000)}`);
    }
    const note = fs.readFileSync(out, 'utf8').replace(/\s+/g, '');
    if (!/HELLOSTASHBASEOCR/i.test(note)) {
      throw new Error(`ocr extractor did not preserve expected text\n${note.slice(0, 1_000)}`);
    }
    console.log('[smoke] python OCR extractor converted a fixture');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function smokePdfExtractor(extractBin) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-smoke-pdf-'));
  try {
    const pdf = path.join(tmp, 'smoke.pdf');
    const out = path.join(tmp, '.smoke.md');
    const bundle = path.join(tmp, '.smoke_files');
    writeTinyPdf(pdf);
    const probe = await runProcess(extractBin, ['pdf', pdf, out, bundle], { timeoutMs: 120_000 });
    if (probe.code !== 0) {
      throw new Error(`pdf extractor failed: exit=${probe.code}\n${probe.output.slice(-4_000)}`);
    }
    const note = fs.readFileSync(out, 'utf8');
    if (!/Hello\s+StashBase\s+PDF\s+smoke/i.test(note)) {
      throw new Error(`pdf extractor did not preserve expected text\n${note.slice(0, 1_000)}`);
    }
    console.log('[smoke] python PDF extractor converted a fixture');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}


const appPath = findPackagedApp();
const layout = packagedLayout(appPath);
const { resourcesPath, appRoot, electronBin } = layout;
const serverEntry = path.join(appRoot, 'dist', 'server', 'index.mjs');
const daemonBin = findSidecarExecutable(resourcesPath, 'stashbase-daemon');
const bundledExtractBin = findSidecarExecutable(resourcesPath, 'stashbase-extract');
if (fs.existsSync(bundledExtractBin)) throw new Error('Base installer unexpectedly includes the downloadable extractor');
const openCodeBin = findPackagedOpenCode(resourcesPath);
const ripgrepBin = process.platform === 'win32' ? path.join(resourcesPath, 'opencode', 'rg.exe') : null;
assertFile(electronBin, 'packaged Electron binary');
assertFile(appRoot, 'app.asar');
assertFile(openCodeBin, 'packaged OpenCode binary');
if (ripgrepBin) assertFile(ripgrepBin, 'packaged Windows ripgrep binary');
assertFile(daemonBin, 'packaged Python daemon sidecar');
assertFile(path.join(resourcesPath, 'python', 'extractor-runtime.json'), 'pinned extractor component manifest');

await smokeElectronMainDependencies(electronBin, appRoot, resourcesPath);
const openCodeProbe = await runProcess(openCodeBin, ['--version'], { timeoutMs: 10_000 });
if (openCodeProbe.code !== 0 || openCodeProbe.output.trim() !== '1.18.19') {
  throw new Error(`unexpected packaged OpenCode version: exit=${openCodeProbe.code} output=${openCodeProbe.output.trim()}`);
}
console.log('[smoke] packaged OpenCode binary is executable and pinned to 1.18.19');
if (ripgrepBin) {
  const ripgrepProbe = await runProcess(ripgrepBin, ['--version'], { timeoutMs: 10_000 });
  if (ripgrepProbe.code !== 0 || !/^ripgrep \d+/m.test(ripgrepProbe.output)) {
    throw new Error(`unexpected packaged ripgrep binary: exit=${ripgrepProbe.code} output=${ripgrepProbe.output.trim()}`);
  }
  console.log('[smoke] packaged Windows ripgrep binary is executable');
}
await smokePackagedOpenCode(openCodeBin);
await smokeDaemon(daemonBin);
{
  const componentHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-extractor-smoke-'));
  const manifest = JSON.parse(fs.readFileSync(path.join(resourcesPath, 'python', 'extractor-runtime.json'), 'utf8'));
  const archive = path.join(releaseDir, manifest.asset);
  assertFile(archive, 'release extractor component');
  const fixtureServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Length': fs.statSync(archive).size });
    fs.createReadStream(archive).pipe(res);
  });
  await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
  try {
    const runtime = createExtractorRuntime({
      root: componentHome, manifest: async () => manifest,
      fetch: (_url, options) => fetch(`http://127.0.0.1:${fixtureServer.address().port}/component`, options),
    });
    const extractBin = await runtime.ensure(AbortSignal.timeout(120_000));
    await smokePdfExtractor(extractBin);
    await smokeOcrExtractor(extractBin);
    const offline = createExtractorRuntime({ root: componentHome, manifest: async () => manifest, fetch: async () => { throw new Error('offline'); } });
    if (await offline.ensure() !== extractBin) throw new Error('Installed component was not reused offline');
    console.log('[smoke] downloaded, verified, installed and reused the independent PDF/OCR component');
  } finally {
    fixtureServer.closeAllConnections();
    await new Promise((resolve) => fixtureServer.close(resolve));
    fs.rmSync(componentHome, { recursive: true, force: true });
  }
}

const port = Number(argValue('--port')) || 18_000 + Math.floor(Math.random() * 20_000);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-smoke-home-'));
const folderHome = path.join(home, 'folders');
const localDataRoot = path.join(home, 'data');
const appData = path.join(home, 'AppData', 'Roaming');
const localAppData = path.join(home, 'AppData', 'Local');
const output = [];

console.log(`[smoke] app ${path.relative(root, appPath)}`);
console.log(`[smoke] server ${serverEntry}`);
console.log(`[smoke] port ${port}`);

const child = spawn(electronBin, [serverEntry, `--port=${port}`], {
  cwd: resourcesPath,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: path.parse(home).root.replace(/[\\/]$/, ''),
    HOMEPATH: home.slice(path.parse(home).root.length - (path.parse(home).root.endsWith(path.sep) ? 1 : 0)),
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    STASHBASE_FOLDER_HOME: folderHome,
    STASHBASE_LOCAL_DATA_ROOT: localDataRoot,
    STASHBASE_APP_ROOT: appRoot,
    STASHBASE_RESOURCES_PATH: resourcesPath,
    STASHBASE_PACKAGED: '1',
    STASHBASE_TELEMETRY_DISABLED: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => output.push(chunk.toString()));
child.stderr.on('data', (chunk) => output.push(chunk.toString()));

try {
  await waitForServer(port, child, output);
  await assertPackagedHealth(port, {
    app: 'stashbase',
    ok: true,
    protocolVersion: 1,
    appRoot,
    resourcesPath,
  });
  console.log('[smoke] packaged server responded');
  await checkPdfResources(port);
  const telemetry = await requestApi(port, 'GET', '/api/telemetry');
  if (telemetry.available !== false) throw new Error('Packaged smoke must disable telemetry before exercising user flows');
  await assertPackagedRendererWorkers(port);
  await assertPackagedUserFlow(port, home);
} finally {
  if (child.exitCode == null) child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(2_000).then(() => {
      if (child.exitCode == null) child.kill('SIGKILL');
    }),
  ]);
  fs.rmSync(home, { recursive: true, force: true });
}
