'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RECORD_VERSION = 1;
const MAX_RESTORED_WINDOWS = 8;

/** Absolute folders, each once at its last position, since the last one
 * opens on top. */
function uniqueFolders(folders) {
  const kept = [];
  for (const folder of [...folders].reverse()) {
    if (typeof folder === 'string' && path.isAbsolute(folder) && !kept.includes(folder)) kept.unshift(folder);
  }
  return kept.slice(-MAX_RESTORED_WINDOWS);
}

/**
 * The projects a launch reopens, one window each, in the order to open them.
 * Main owns the record because it owns windows; what each project showed
 * (tabs, tree) stays with the workspace session. A missing or unreadable
 * record reopens nothing, and a failed write keeps the previous record.
 */
function createWindowRestoreRecord({ filePath, fileSystem = fs }) {
  let written = null;
  return {
    read() {
      try {
        const parsed = JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
        if (parsed?.version !== RECORD_VERSION || !Array.isArray(parsed.folders)) return [];
        return uniqueFolders(parsed.folders);
      } catch {
        return [];
      }
    },
    write(folders) {
      const contents = `${JSON.stringify({ version: RECORD_VERSION, folders: uniqueFolders(folders) })}\n`;
      if (contents === written) return;
      const temporary = `${filePath}.${process.pid}.tmp`;
      try {
        fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
        fileSystem.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 });
        fileSystem.renameSync(temporary, filePath);
        written = contents;
      } catch {
        try { fileSystem.rmSync(temporary, { force: true }); } catch { /* nothing to remove */ }
      }
    },
  };
}

/**
 * The projects the open windows show, the focused window's last so it opens
 * on top. With no window left (macOS keeps the app running after the last
 * one closes), the project of the window that just closed stands in, so the
 * next launch still returns to it. A Welcome window adds nothing.
 */
function foldersToRestore({ windows, folderFor, focused = null, closing = null }) {
  const open = windows.filter((win) => win !== closing);
  if (open.length === 0) {
    const folder = closing ? folderFor(closing) : null;
    return folder ? [folder] : [];
  }
  const ordered = [...open.filter((win) => win !== focused), ...open.filter((win) => win === focused)];
  return ordered.map(folderFor).filter(Boolean);
}

/**
 * Reopen the recorded projects at launch. The first window is the one the
 * launch already created; a project that cannot be entered (moved, deleted,
 * no longer a project) leaves its window for the next one, and a window left
 * over is closed unless it is the only one, which stays on Welcome.
 */
async function reopenFolders({ folders, firstWindow, createWindow, enterFolder, isLive, onFailure = () => {} }) {
  let vacant = firstWindow ?? null;
  const opened = [];
  for (const folder of folders) {
    const target = vacant ?? await createWindow();
    if (!target || !isLive(target)) break;
    try {
      await enterFolder(target, folder);
      opened.push(target);
      vacant = null;
    } catch (error) {
      onFailure(folder, error);
      vacant = target;
    }
  }
  if (vacant && vacant !== firstWindow && isLive(vacant)) vacant.close();
  return opened;
}

module.exports = {
  createWindowRestoreRecord,
  foldersToRestore,
  reopenFolders,
};
