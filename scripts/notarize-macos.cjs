const path = require('node:path');
const { notarize } = require('@electron/notarize');
const { isAppleTicketConnectionLoss, stapler } = require('./apple-ticket.cjs');

module.exports = async function notarizeMacos(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const { APPLE_API_KEY: appleApiKey, APPLE_API_KEY_ID: appleApiKeyId, APPLE_API_ISSUER: appleApiIssuer } = process.env;
  if (!appleApiKey || !appleApiKeyId || !appleApiIssuer) {
    throw new Error('APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER are required for notarization.');
  }

  try {
    await notarize({ appPath, tool: 'notarytool', appleApiKey, appleApiKeyId, appleApiIssuer });
  } catch (error) {
    // @electron/notarize reaches stapling only after Apple accepts notarization.
    // Its short built-in retries can all land inside one CloudKit outage.
    if (!isAppleTicketConnectionLoss(error) || !String(error.message).includes('Failed to staple')) throw error;
    await stapler('staple', appPath);
  }
  await stapler('validate', appPath);
  console.log('[macOS notarization] accepted, stapled, and validated');
};
