'use strict';

const os = require('node:os');

function freezeDiagnostics(value) {
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    capturedAt: value.capturedAt,
    app: Object.freeze({ ...value.app }),
    os: Object.freeze({ ...value.os }),
  });
}

/**
 * Produce the deliberately small, privacy-reviewed diagnostics allowlist.
 * This module must never expand the shape from process state opportunistically.
 */
function collectBugReportDiagnostics({
  app,
  platform = os.platform,
  release = os.release,
  arch = os.arch,
  electronVersion = process.versions.electron,
  now = () => new Date(),
} = {}) {
  if (!app || typeof app.getName !== 'function' || typeof app.getVersion !== 'function') {
    throw new Error('Electron app metadata is unavailable');
  }
  const capturedAt = now();
  const capturedAtIso = capturedAt instanceof Date ? capturedAt.toISOString() : new Date(capturedAt).toISOString();
  return freezeDiagnostics({
    schemaVersion: 1,
    capturedAt: capturedAtIso,
    app: {
      name: String(app.getName()),
      version: String(app.getVersion()),
      packaged: app.isPackaged === true,
      electronVersion: String(electronVersion ?? ''),
    },
    os: {
      platform: String(platform()),
      release: String(release()),
      arch: String(arch()),
    },
  });
}

module.exports = {
  collectBugReportDiagnostics,
};
