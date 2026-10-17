'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { scanBugReportText } = require('./bug-report-redaction.cjs');
const { ARTIFACT_KIND } = require('./bug-report-service.cjs');

const GITHUB_NEW_ISSUE_URL = 'https://github.com/liliu-z/stashbase/issues/new';
const DOWNLOADS_FOLDER_BASE_NAME = 'StashBase bug report';

const HANDOFF_ERROR = Object.freeze({
  PREPARE_FAILED: Object.freeze({
    code: 'PREPARE_FAILED',
    message: 'StashBase could not prepare the selected report files. Nothing was opened. Please try again.',
  }),
  DOWNLOADS_FAILED: Object.freeze({
    code: 'DOWNLOADS_FAILED',
    message: 'The report files could not be saved to your Downloads folder. GitHub was not opened. Please try again.',
  }),
  GITHUB_OPEN_FAILED: Object.freeze({
    code: 'GITHUB_OPEN_FAILED',
    message: 'The report files were saved to your Downloads folder, but StashBase could not open GitHub. Please try again.',
  }),
  SAVE_FAILED: Object.freeze({
    code: 'SAVE_FAILED',
    message: 'The report files could not be saved to your Downloads folder. Please try again.',
  }),
});

function fail(error, artifactCount = null) {
  const result = { ok: false, error: { code: error.code, message: error.message } };
  if (Number.isSafeInteger(artifactCount) && artifactCount >= 0) {
    result.prepared = { artifactCount };
  }
  return result;
}

function createFilesystemId() {
  return crypto.randomBytes(18).toString('base64url');
}

function validFilesystemId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function inlineValue(value, fallback = 'Unavailable') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function diagnosticsView(resource) {
  if (!resource || typeof resource !== 'object' || !resource.app || !resource.os) return null;
  return {
    capturedAt: inlineValue(resource.capturedAt),
    application: inlineValue(resource.app.name),
    version: inlineValue(resource.app.version),
    mode: resource.app.packaged === true ? 'Packaged' : 'Development',
    electron: inlineValue(resource.app.electronVersion),
    platform: inlineValue(resource.os.platform),
    osRelease: inlineValue(resource.os.release),
    architecture: inlineValue(resource.os.arch),
  };
}

function formatDiagnosticsArtifact(resource) {
  const diagnostics = diagnosticsView(resource);
  if (!diagnostics) throw new Error('Invalid diagnostics artifact');
  return [
    `Captured: ${diagnostics.capturedAt}`,
    `Application: ${diagnostics.application}`,
    `Version: ${diagnostics.version}`,
    `Mode: ${diagnostics.mode}`,
    `Electron: ${diagnostics.electron}`,
    `Platform: ${diagnostics.platform}`,
    `OS release: ${diagnostics.osRelease}`,
    `Architecture: ${diagnostics.architecture}`,
    '',
  ].join('\n');
}

function environmentMarkdown(snapshot) {
  const diagnosticsArtifact = snapshot?.artifacts?.find((artifact) => (
    artifact?.kind === ARTIFACT_KIND.DIAGNOSTICS
  ));
  const diagnostics = diagnosticsView(diagnosticsArtifact?.resource);
  if (!diagnostics) return '- Not included in this report.';
  return [
    `- Application: ${diagnostics.application}`,
    `- Version: ${diagnostics.version}`,
    `- Mode: ${diagnostics.mode}`,
    `- Electron: ${diagnostics.electron}`,
    `- Platform: ${diagnostics.platform}`,
    `- OS release: ${diagnostics.osRelease}`,
    `- Architecture: ${diagnostics.architecture}`,
  ].join('\n');
}

function issueTitle(snapshot) {
  const problem = inlineValue(snapshot?.description?.problem, '');
  if (problem) {
    const maximumLength = 100;
    return problem.length <= maximumLength
      ? problem
      : `${problem.slice(0, maximumLength - 1).trimEnd()}\u2026`;
  }
  const diagnosticsArtifact = snapshot?.artifacts?.find((artifact) => (
    artifact?.kind === ARTIFACT_KIND.DIAGNOSTICS
  ));
  const application = diagnosticsView(diagnosticsArtifact?.resource)?.application;
  return `${application && application !== 'Unavailable' ? application : 'StashBase'} bug report`;
}

function reportField(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '_Not provided._';
}

function buildGitHubIssueBody(snapshot) {
  return [
    '## Problem',
    '',
    reportField(snapshot?.description?.problem),
    '',
    '## Steps to reproduce',
    '',
    reportField(snapshot?.description?.reproduction),
    '',
    '## Environment',
    '',
    environmentMarkdown(snapshot),
  ].join('\n');
}

function buildGitHubIssueUrl(snapshot) {
  const url = new URL(GITHUB_NEW_ISSUE_URL);
  url.searchParams.set('title', issueTitle(snapshot));
  url.searchParams.set('body', buildGitHubIssueBody(snapshot));
  return url.toString();
}

function artifactFile(artifact) {
  if (!artifact || typeof artifact !== 'object') throw new Error('Invalid artifact');
  if (artifact.kind === ARTIFACT_KIND.SCREENSHOT) {
    if (!Buffer.isBuffer(artifact.resource?.bytes) || artifact.resource.mimeType !== 'image/png') {
      throw new Error('Invalid screenshot artifact');
    }
    return { name: 'screenshot.png', content: artifact.resource.bytes, text: false };
  }
  if (artifact.kind === ARTIFACT_KIND.LOG) {
    if (typeof artifact.resource?.text !== 'string') throw new Error('Invalid log artifact');
    return { name: 'application-log.txt', content: artifact.resource.text, text: true };
  }
  if (artifact.kind === ARTIFACT_KIND.DIAGNOSTICS) {
    return { name: 'diagnostics.txt', content: formatDiagnosticsArtifact(artifact.resource), text: true };
  }
  throw new Error('Unsupported bug-report artifact');
}

function createBugReportHandoff({
  baseTemporaryDirectory,
  fsModule = fs,
  pathModule = path,
  scanText = scanBugReportText,
  createSessionId = createFilesystemId,
  createReportId = createFilesystemId,
  createTemporaryId = createFilesystemId,
  downloadsDirectory,
  openExternal,
} = {}) {
  if (
    typeof baseTemporaryDirectory !== 'string'
    || !pathModule.isAbsolute(baseTemporaryDirectory)
    || typeof downloadsDirectory !== 'function'
    || typeof openExternal !== 'function'
  ) {
    throw new TypeError('Bug-report handoff dependencies are required.');
  }

  let sessionDirectory = null;
  let initialization = null;
  const preparedByApproval = new Map();
  const downloadsByApproval = new Map();
  const pendingDownloads = new Map();

  async function allocateDownloadsFolder() {
    const root = await downloadsDirectory();
    if (typeof root !== 'string' || !pathModule.isAbsolute(root)) {
      throw new Error('Invalid downloads directory');
    }
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const name = attempt === 1 ? DOWNLOADS_FOLDER_BASE_NAME : `${DOWNLOADS_FOLDER_BASE_NAME} ${attempt}`;
      const destination = pathModule.join(root, name);
      try {
        await fsModule.mkdir(destination, { recursive: false });
        return destination;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    throw new Error('No available downloads folder name');
  }

  // One approval keeps one Downloads folder: retries and repeated actions heal
  // that folder instead of accumulating copies; a fresh approval allocates a
  // new one.
  async function copyPreparedFiles(snapshot, prepared) {
    let destination = downloadsByApproval.get(snapshot.approvalId) ?? null;
    if (destination) await fsModule.mkdir(destination, { recursive: true });
    else {
      destination = await allocateDownloadsFolder();
      downloadsByApproval.set(snapshot.approvalId, destination);
    }
    for (const fileName of prepared.fileNames) {
      await fsModule.copyFile(
        pathModule.join(prepared.directory, fileName),
        pathModule.join(destination, fileName),
      );
    }
  }

  async function copyPreparedToDownloads(snapshot, prepared) {
    const cached = pendingDownloads.get(snapshot.approvalId);
    if (cached) return cached;
    const pending = copyPreparedFiles(snapshot, prepared);
    pendingDownloads.set(snapshot.approvalId, pending);
    try {
      return await pending;
    } finally {
      // Retry a failed or deleted copy in the same allocated folder. Only
      // overlapping requests share work; a later request can repair files.
      pendingDownloads.delete(snapshot.approvalId);
    }
  }

  async function initializeSession() {
    if (sessionDirectory) return;
    if (!initialization) {
      initialization = (async () => {
        const sessionId = createSessionId();
        if (!validFilesystemId(sessionId)) throw new Error('Invalid bug-report session identifier');
        await fsModule.rm(baseTemporaryDirectory, { recursive: true, force: true });
        const nextSessionDirectory = pathModule.join(baseTemporaryDirectory, `session-${sessionId}`);
        await fsModule.mkdir(nextSessionDirectory, { recursive: true, mode: 0o700 });
        sessionDirectory = nextSessionDirectory;
      })().catch((error) => {
        initialization = null;
        throw error;
      });
    }
    await initialization;
  }

  async function writeAtomic(directory, file) {
    if (file.text && !scanText(file.content)?.safe) throw new Error('Final artifact privacy check failed');
    const temporaryId = createTemporaryId();
    if (!validFilesystemId(temporaryId)) throw new Error('Invalid temporary artifact identifier');
    const destination = pathModule.join(directory, file.name);
    const temporary = pathModule.join(directory, `.${file.name}.${temporaryId}.tmp`);
    try {
      await fsModule.writeFile(temporary, file.content, { flag: 'wx', mode: 0o600 });
      await fsModule.rename(temporary, destination);
    } catch (error) {
      await fsModule.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function materializeUncached(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !validFilesystemId(snapshot.approvalId)) {
      throw new Error('Invalid approved report snapshot');
    }
    await initializeSession();

    const reportId = createReportId();
    if (!validFilesystemId(reportId)) throw new Error('Invalid bug-report identifier');
    const reportDirectory = pathModule.join(sessionDirectory, `report-${reportId}`);
    await fsModule.mkdir(reportDirectory, { recursive: false, mode: 0o700 });
    try {
      const files = snapshot.artifacts.map(artifactFile);
      for (const file of files) await writeAtomic(reportDirectory, file);
      const issueBody = buildGitHubIssueBody(snapshot);
      const title = issueTitle(snapshot);
      if (!scanText(issueBody)?.safe || !scanText(title)?.safe) {
        throw new Error('Final GitHub issue privacy check failed');
      }
      const prepared = Object.freeze({
        directory: reportDirectory,
        artifactCount: files.length,
        fileNames: Object.freeze(files.map((file) => file.name)),
        issueUrl: buildGitHubIssueUrl(snapshot),
      });
      return prepared;
    } catch (error) {
      await fsModule.rm(reportDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function materialize(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !validFilesystemId(snapshot.approvalId)) {
      throw new Error('Invalid approved report snapshot');
    }
    const cached = preparedByApproval.get(snapshot.approvalId);
    if (cached) return cached;

    const inFlight = materializeUncached(snapshot);
    preparedByApproval.set(snapshot.approvalId, inFlight);
    try {
      return await inFlight;
    } catch (error) {
      if (preparedByApproval.get(snapshot.approvalId) === inFlight) {
        preparedByApproval.delete(snapshot.approvalId);
      }
      throw error;
    }
  }

  return Object.freeze({
    initializeSession,

    async prepare(snapshot) {
      try {
        const prepared = await materialize(snapshot);
        return { ok: true, prepared: { artifactCount: prepared.artifactCount } };
      } catch {
        return fail(HANDOFF_ERROR.PREPARE_FAILED);
      }
    },

    async openGitHub(snapshot) {
      const prepared = await preparedByApproval.get(snapshot?.approvalId);
      if (!prepared) return fail(HANDOFF_ERROR.PREPARE_FAILED);

      try {
        await copyPreparedToDownloads(snapshot, prepared);
      } catch {
        return fail(HANDOFF_ERROR.DOWNLOADS_FAILED, prepared.artifactCount);
      }

      try {
        const opened = await openExternal(prepared.issueUrl);
        if (opened === false || (typeof opened === 'string' && opened)) throw new Error('Open failed');
      } catch {
        return fail(HANDOFF_ERROR.GITHUB_OPEN_FAILED, prepared.artifactCount);
      }

      return { ok: true, prepared: { artifactCount: prepared.artifactCount } };
    },

    async saveToDownloads(snapshot) {
      const prepared = await preparedByApproval.get(snapshot?.approvalId);
      if (!prepared) return fail(HANDOFF_ERROR.PREPARE_FAILED);

      try {
        await copyPreparedToDownloads(snapshot, prepared);
      } catch {
        return fail(HANDOFF_ERROR.SAVE_FAILED, prepared.artifactCount);
      }
      return { ok: true, saved: { artifactCount: prepared.artifactCount } };
    },
  });
}

module.exports = {
  GITHUB_NEW_ISSUE_URL,
  buildGitHubIssueBody,
  buildGitHubIssueUrl,
  createBugReportHandoff,
};
