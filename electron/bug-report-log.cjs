'use strict';

const fs = require('node:fs');
const { prepareBugReportText } = require('./bug-report-redaction.cjs');

const MAX_LOG_TAIL_BYTES = 32 * 1024;
const INTERNAL_PATH_LOG_PREFIX = /^(?:server entry|server cwd|resources|daemon|extractor|python):\s*/;

/**
 * Startup diagnostics include application-installation paths. They are useful
 * in the normal local log but are not report content, so remove them before
 * the report redaction boundary rather than trying to disclose those paths.
 */
function omitInternalPathLogLines(text) {
  return text.split(/(?<=\n)/).filter((line) => !INTERNAL_PATH_LOG_PREFIX.test(line)).join('');
}

/** Read a bounded tail without loading the rest of the application log. */
function readApplicationLogTail({
  filePath,
  maxBytes = MAX_LOG_TAIL_BYTES,
  fsModule = fs,
} = {}) {
  if (typeof filePath !== 'string' || !filePath || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    return null;
  }
  let fd;
  try {
    const stat = fsModule.statSync(filePath);
    if (!stat || !Number.isSafeInteger(stat.size) || stat.size <= 0) return { text: '', truncated: false, bytesRead: 0 };
    const bytesToRead = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - bytesToRead);
    const buffer = Buffer.alloc(bytesToRead);
    fd = fsModule.openSync(filePath, 'r');
    const bytesRead = fsModule.readSync(fd, buffer, 0, bytesToRead, start);
    let text = buffer.subarray(0, Math.max(0, bytesRead)).toString('utf8');
    if (start > 0) {
      const firstNewline = text.search(/\r?\n/);
      text = firstNewline === -1 ? '' : text.slice(firstNewline + (text[firstNewline] === '\r' ? 2 : 1));
    }
    return { text, truncated: start > 0, bytesRead };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fsModule.closeSync(fd); } catch { /* best effort */ }
    }
  }
}

function collectRedactedApplicationLog(options = {}) {
  const {
    homeDir,
    redact,
    scan,
    ...tailOptions
  } = options;
  const tail = readApplicationLogTail(tailOptions);
  if (!tail) return null;
  const prepared = prepareBugReportText(omitInternalPathLogLines(tail.text), { homeDir, redact, scan });
  if (!prepared.ok) return null;
  return {
    text: prepared.text,
    byteLength: Buffer.byteLength(prepared.text, 'utf8'),
    truncated: tail.truncated,
    bytesRead: tail.bytesRead,
    redactionCount: prepared.redactionCount,
  };
}

module.exports = {
  collectRedactedApplicationLog,
  readApplicationLogTail,
};
