'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');
const { APP_URL, installAppProtocol, registerAppScheme } = require('../app-protocol.cjs');
const { createBugReportService } = require('../bug-report-service.cjs');
const { collectRedactedApplicationLog } = require('../bug-report-log.cjs');
const { collectBugReportDiagnostics } = require('../bug-report-diagnostics.cjs');
const { captureWindowScreenshot } = require('../bug-report-screenshot.cjs');
const { createBugReportHandoff } = require('../bug-report-handoff.cjs');
const { createBugReportReviewWindow } = require('../bug-report-review-window.cjs');

registerAppScheme(protocol);
app.on('window-all-closed', () => {});
const repository = path.resolve(__dirname, '../..');
let temporaryRoot;
const timeout = setTimeout(() => app.exit(1), 30_000);

async function run() {
  await app.whenReady();
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stashbase-report-smoke-'));
  const downloads = path.join(temporaryRoot, 'downloads');
  const logPath = path.join(temporaryRoot, 'application.log');
  await fs.mkdir(downloads);
  await fs.writeFile(logPath, JSON.stringify({ cwd: os.homedir(), accessToken: 'synthetic-secret' }));
  installAppProtocol({
    protocol, net, rendererRoot: path.join(repository, 'dist', 'renderer'),
    serverOrigin: 'http://127.0.0.1:1',
  });
  const source = new BrowserWindow({
    show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await source.loadURL('data:text/html,<h1>Bug report smoke fixture</h1>');
  const reports = createBugReportService({
    captureScreenshot: () => captureWindowScreenshot(source.webContents),
    collectDiagnostics: () => collectBugReportDiagnostics({ app }),
    collectLog: () => collectRedactedApplicationLog({ filePath: logPath }),
  });
  const created = await reports.createDraft({ webContentsId: source.webContents.id, windowId: 'smoke' });
  assert.equal(created.ok, true);
  const handoff = createBugReportHandoff({
    baseTemporaryDirectory: path.join(temporaryRoot, 'reports'),
    downloadsDirectory: () => downloads,
    openExternal: () => { throw new Error('This smoke must not open a browser'); },
  });
  const reviewUrl = `${APP_URL}bug-report.html`;
  const review = createBugReportReviewWindow({
    BrowserWindow, appUrl: reviewUrl,
    preloadPath: path.join(repository, 'dist/electron/bug-report/review-window-preload.cjs'),
  });
  const senderId = review.window.webContents.id;
  assert.equal(reports.bindReviewWindow(created.draft.id, senderId).ok, true);
  const { registerBugReportReviewIpc } = require('../../dist/electron/bug-report/review-ipc.cjs');
  const sessions = new Map([[senderId, created.draft.id]]);
  registerBugReportReviewIpc({
    ipcMain,
    bugReports: reports,
    isReviewFrameUrl: (url) => url === reviewUrl,
    draftIdForSender: (id) => sessions.get(id),
    prepareApprovedReport: (snapshot) => handoff.prepare(snapshot),
    openPreparedReport: (snapshot) => handoff.openGitHub(snapshot),
    savePreparedReport: (snapshot) => handoff.saveToDownloads(snapshot),
  });
  await review.loaded;
  await review.window.webContents.executeJavaScript(`(async () => {
    const button = (label) => [...document.querySelectorAll('button')].find(
      (el) => el.textContent.trim() === label || el.getAttribute('aria-label') === label);
    const wait = async (check) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const value = check();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Bug report UI did not settle');
    };
    const field = await wait(() => document.querySelector('textarea'));
    const setText = (text) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setText('password="synthetic-secret');
    await wait(() => field.value === 'password="synthetic-secret');
    button('Prepare report').click();
    await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('privacy'));
    if (field.disabled || field.value !== 'password="synthetic-secret') {
      throw new Error('A refused save lost the editable description');
    }
    setText('Opening the note showed a blank preview.');
    button('Preview for Application log').click();
    await wait(() => document.querySelector('pre'));
    const log = document.querySelector('pre').textContent;
    if (log.includes('synthetic-secret') || !log.includes('"cwd":"~"')) {
      throw new Error('The preview exposed an unredacted log');
    }
    const screenshot = [...document.querySelectorAll('[role="switch"]')].find(
      (el) => document.getElementById(el.getAttribute('aria-labelledby'))?.textContent === 'Include Screenshot in the report');
    if (screenshot && !screenshot.disabled) screenshot.click();
    await wait(() => !screenshot || screenshot.disabled || screenshot.getAttribute('aria-checked') === 'false');
    button('Prepare report').click();
    await wait(() => document.querySelector('h1')?.textContent === 'Report ready');
    button('Download').click();
    await wait(() => document.querySelector('[role="status"]')?.textContent.includes('Downloads'));
    const copies = await Promise.all([
      window.stashbase.bugReportReview.saveArtifacts(),
      window.stashbase.bugReportReview.saveArtifacts(),
    ]);
    if (!copies.every((result) => result.ok)) throw new Error('Concurrent export failed');
    button('Back').click();
    await wait(() => document.querySelector('textarea')?.value === 'Opening the note showed a blank preview.');
    button('Cancel').click();
  })()`);
  assert.deepEqual(await fs.readdir(downloads), ['StashBase bug report']);
  const exported = await fs.readFile(path.join(downloads, 'StashBase bug report/application-log.txt'), 'utf8');
  assert.equal(exported.includes('synthetic-secret'), false);
  assert.equal(exported.includes(os.homedir()), false);
  assert.equal(exported.includes('"cwd":"~"'), true);
  console.log('real bug-report privacy refusal, safe preview, prepare, Downloads, back, and cancel smoke passed');
}

run().then(async () => {
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
  app.quit();
}).catch(async (error) => {
  console.error(error);
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  app.exit(1);
});
