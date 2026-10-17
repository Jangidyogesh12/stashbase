const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');

const execFileAsync = promisify(execFile);
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

function errorText(error) {
  return [error?.message, error?.stdout, error?.stderr].filter(Boolean).join('\n');
}

function isAppleTicketConnectionLoss(error) {
  const detail = errorText(error);
  return detail.includes('NSURLErrorDomain Code=-1005')
    && detail.includes('api.apple-cloudkit.com');
}

async function retryAppleTicket(operation, { label, delays = RETRY_DELAYS_MS, sleep = delay } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isAppleTicketConnectionLoss(error) || attempt >= delays.length) throw error;
      console.warn(`[macOS ticket] ${label}: Apple ticket connection lost; retry ${attempt + 1}/${delays.length}`);
      await sleep(delays[attempt]);
    }
  }
}

async function stapler(action, appPath) {
  return retryAppleTicket(
    () => execFileAsync('/usr/bin/xcrun', ['stapler', action, appPath]),
    { label: `stapler ${action}` },
  );
}

module.exports = { isAppleTicketConnectionLoss, retryAppleTicket, stapler };
