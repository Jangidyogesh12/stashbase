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
module.exports = { attachWindowDiagnostics };
