/** Main owns these observations so a dead renderer need not report its own exit.
 * Only ephemeral identities and OS exit facts cross into the consent-owned spool. */
function attachWindowDiagnostics(win, { windowId, appSessionId, hostInstanceId, record, quitting }) {
  let pid;
  const webContentsId = win.webContents.id;
  const context = (stage, reason) => ({
    process: 'renderer', window_id: windowId, app_session_id: appSessionId,
    ...(hostInstanceId() ? { host_instance_id: hostInstanceId() } : {}),
    web_contents_id: webContentsId, ...(pid ? { pid } : {}), stage, reason,
  });
  win.webContents.on('did-finish-load', () => {
    pid = win.webContents.getOSProcessId() || undefined;
    record({ message: 'Renderer loaded' }, 'window-lifecycle', context('loaded', 'navigation'), 'info');
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    record({ message: `Renderer exited: ${details.reason}`, exitCode: details.exitCode },
      'window-lifecycle', context('exit', details.reason), details.reason === 'clean-exit' ? 'info' : 'error');
  });
  win.on('closed', () => {
    record({ message: 'Window closed' }, 'window-lifecycle', context('closed', quitting() ? 'app_shutdown' : 'window_closed'), 'info');
  });
}
function attachChildProcessDiagnostics(app, { appSessionId, hostInstanceId, record }) {
  app.on('child-process-gone', (_event, details) => {
    // The network service owns every renderer's loopback socket. Its exit can
    // drop all chats while both the renderer and the host remain alive. Only
    // recognize Chromium's fixed identifier; never collect utility names.
    const network = details.type === 'Utility' && details.serviceName === 'network.mojom.NetworkService';
    if (details.reason === 'clean-exit' && !network) return;
    record({ message: `Child process exited: ${details.reason}`, exitCode: details.exitCode },
      'native', { process: network ? 'network-service' : details.type, stage: 'exit', reason: details.reason, app_session_id: appSessionId,
        ...(hostInstanceId() ? { host_instance_id: hostInstanceId() } : {}) }, details.reason === 'clean-exit' ? 'info' : 'error');
  });
}
module.exports = { attachWindowDiagnostics, attachChildProcessDiagnostics };
