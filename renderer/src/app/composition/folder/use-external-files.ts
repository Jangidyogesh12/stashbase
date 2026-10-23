/**
 * Files dropped on the document pane, bound to the window's live runtimes.
 *
 * A dropped file opens where it is, in a tab of its own, and goes to the chat
 * beside it; a file already in a project opens as itself, and goes to the
 * chat only when that chat can use it.
 * Closing the tab ends the read grant and takes back the card the drop added.
 * Nothing here copies, prepares, or indexes a file: a file that cannot open in
 * place is refused, and Files remains where a file is copied into the project.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { openDocument } from '@/app/workflows/open-document';
import {
  attachDroppedSource,
  releaseDroppedSource,
  type AgentWorkspaceRuntime,
} from '@/features/agent/public';
import type {
  DocumentDropNotice,
  DocumentTabsRuntime,
  ExternalFileOpening,
  ExternalFilePort,
} from '@/features/documents/public';
import type { WorkspaceRuntime } from '@/features/workspace/public';
import { externalFileToken } from '@/shared/domain/external-source';
import type { SourceReference } from '@/shared/domain/source-reference';

export interface ExternalFiles {
  /** The account of the last drop that did not fully open, or null. */
  notice: DocumentDropNotice | null;
  /** Absent where a dropped file has no location, as in the web build. */
  dropFiles?: ((files: File[]) => void) | undefined;
}

type Refusal = Extract<ExternalFileOpening, { kind: 'refused' }>;
type Refused = Pick<Refusal, 'name' | 'reason'>;

function sourceKey(source: SourceReference): string {
  return `${source.folderPath}\0${source.path}`;
}

/** Whether the chat beside can use a dropped source as context, as its send
 *  will check it: an external file by its own path, a project file only in
 *  the chat's own project and while that project's listing shows it. Another
 *  project's file, or one the tree hides, opens all the same; bound, it would
 *  only refuse the next send. */
function chatCanUse(agent: AgentWorkspaceRuntime, source: SourceReference): boolean {
  if (externalFileToken(source)) return true;
  if (agent.activeSession().store.getState().scope.path !== source.folderPath) return false;
  const environment = agent.store.getState().scopeEnvironment;
  return (
    environment?.folderPath !== source.folderPath ||
    environment.listing.files.some((file) => file.path === source.path)
  );
}

/** A few names, then a count, so one drop of many files stays one line. */
function nameList(names: readonly string[]): string {
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}

/** One message for everything a drop could not open. */
export function droppedFilesMessage(refused: readonly Refused[]): string {
  const named = (reason: Refusal['reason']) =>
    refused.filter((entry) => entry.reason === reason).map((entry) => entry.name);
  const sentences: string[] = [];
  const copy = named('copy-required');
  // Files is where a file joins the project; the drop only names it.
  if (copy.length === 1) {
    sentences.push(`${copy[0]} cannot open here. To add it to the project, drop it on Files.`);
  } else if (copy.length > 1) {
    sentences.push(
      `${copy.length} files cannot open here: ${nameList(copy)}. To add them to the project, drop them on Files.`,
    );
  }
  if (named('directory').length > 0) {
    sentences.push('Folders cannot open here. To use a whole folder, open it as a project.');
  }
  const failed = [...named('unavailable'), ...named('no-project')];
  if (failed.length === 1) sentences.push(`${failed[0]} could not be opened.`);
  else if (failed.length > 1) {
    sentences.push(`${failed.length} files could not be opened: ${nameList(failed)}.`);
  }
  return sentences.join(' ');
}

export function useExternalFiles({
  agent,
  documents,
  externalFiles,
  onOpened,
  workspace,
}: {
  agent: AgentWorkspaceRuntime;
  documents: DocumentTabsRuntime | null;
  externalFiles: ExternalFilePort;
  /** Brings Documents on screen once a drop opened something, since the
   *  file may have been dropped on the chat while Chats had the row. */
  onOpened?: (() => void) | undefined;
  workspace: WorkspaceRuntime | null;
}): ExternalFiles {
  const [notice, setNotice] = useState<string | null>(null);
  /** Sources a drop opened, with the chat their card went to. */
  const dropped = useRef(new Map<string, { source: SourceReference; chat: string }>());

  // A closed tab ends what its drop began: the read grant and the card.
  useEffect(() => {
    if (!documents) return;
    const opened = dropped.current;
    const end = (entry: { source: SourceReference; chat: string }) => {
      releaseDroppedSource(agent, entry.chat, entry.source);
      if (externalFileToken(entry.source)) void externalFiles.revoke(entry.source);
    };
    const unsubscribe = documents.subscribe(() => {
      const open = new Set(documents.openSources().map(sourceKey));
      for (const [key, entry] of opened) {
        if (open.has(key)) continue;
        opened.delete(key);
        end(entry);
      }
    });
    return () => {
      unsubscribe();
      // Leaving the project closes every tab its drops opened.
      for (const entry of opened.values()) end(entry);
      opened.clear();
      setNotice(null);
    };
  }, [agent, documents, externalFiles]);

  const openDropped = useCallback(
    async (source: SourceReference) => {
      if (!workspace || !documents) return false;
      const opened = await openDocument(workspace, documents, source, { preview: false });
      if (!opened) return false;
      // An external file is always usable, so every grant is tracked here
      // and ends with its tab.
      if (chatCanUse(agent, source)) {
        dropped.current.set(sourceKey(source), {
          chat: attachDroppedSource(agent, source),
          source,
        });
      }
      onOpened?.();
      return true;
    },
    [agent, documents, onOpened, workspace],
  );

  const dropFiles = useCallback(
    (files: File[]) => {
      if (!workspace || !documents) return;
      const folderPath = workspace.scope.folder.path;
      setNotice(null);
      void (async () => {
        const refused: Refused[] = [];
        // In drop order, one at a time, so the last file ends up in front.
        for (const file of files) {
          const opening = await externalFiles.open(file);
          if (opening.kind === 'refused') {
            refused.push(opening);
            continue;
          }
          const source =
            opening.kind === 'external'
              ? opening.source
              : { folderPath: opening.folderPath ?? folderPath, path: opening.path };
          if (!(await openDropped(source))) {
            // A file the pane tried and failed to open is already reported
            // there, with Retry; one drop says each failure once.
            const reported = documents.store.getState().openFailure;
            if (!reported || sourceKey(reported.source) !== sourceKey(source)) {
              refused.push({ name: file.name, reason: 'unavailable' });
            }
          }
        }
        // A drop that outlived its project has nothing left to report on.
        if (refused.length > 0 && !documents.signal.aborted) {
          setNotice(droppedFilesMessage(refused));
        }
      })();
    },
    [documents, externalFiles, openDropped, workspace],
  );

  const view = useMemo<DocumentDropNotice | null>(
    () => (notice ? { message: notice, onDismiss: () => setNotice(null) } : null),
    [notice],
  );

  return {
    notice: view,
    ...(externalFiles.available ? { dropFiles } : {}),
  };
}
