/**
 * Keep electron-updater's platform-specific install details outside the
 * update state machine. In particular, AppImage's force-run mode starts the
 * replacement process before the current instance releases its single-
 * instance lock. Scheduling an Electron relaunch after the old process exits
 * avoids that race.
 */
function createUpdateInstaller(options) {
  const {
    updater,
    app,
    platform,
    appImagePath,
    fileExists,
    onInstalledWithoutRelaunch = () => {},
  } = options;

  if (platform === 'linux' && !appImagePath) {
    return () => {
      // DebUpdater normally calls app.relaunch() inside doInstall, before
      // Electron's will-quit handler has waited for our server to exit. Keep
      // that relaunch under main's shutdown owner instead.
      let installError = null;
      const onError = (error) => { installError = error; };
      updater.on('error', onError);
      updater.autoRunAppAfterInstall = false;
      try {
        updater.quitAndInstall(false, false);
        if (installError) throw installError;
        onInstalledWithoutRelaunch();
      } finally {
        updater.removeListener('error', onError);
      }
    };
  }

  if (platform !== 'linux' || !appImagePath) {
    return () => {
      // NSIS can install silently once the user has clicked Update. macOS and
      // Linux deb retain their native installer behavior; deb may show an
      // administrator authorization prompt.
      updater.quitAndInstall(platform === 'win32', true);
    };
  }

  return () => {
    let relaunchPath = appImagePath;
    let installError = null;
    const onFilenameUpdated = (nextPath) => {
      if (typeof nextPath === 'string' && nextPath) relaunchPath = nextPath;
    };
    const onError = (error) => { installError = error; };

    updater.on('appimage-filename-updated', onFilenameUpdated);
    updater.on('error', onError);
    try {
      // AppImageUpdater's non-force path applies the downloaded image without
      // launching it. Electron then starts the final path only after this
      // process exits, when the single-instance lock is no longer held.
      updater.autoRunAppAfterInstall = false;
      updater.quitAndInstall(false, false);
      if (installError) throw installError;
      if (!fileExists(relaunchPath)) {
        throw new Error(`Installed AppImage was not found at ${relaunchPath}`);
      }
      app.relaunch({ execPath: relaunchPath });
    } finally {
      updater.removeListener('appimage-filename-updated', onFilenameUpdated);
      updater.removeListener('error', onError);
    }
  };
}

module.exports = { createUpdateInstaller };
