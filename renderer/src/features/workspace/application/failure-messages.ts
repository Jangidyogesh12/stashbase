/**
 * One reader-facing sentence per workspace failure kind.
 *
 * Both workspace ladders are answered here: the project's bare transport kinds
 * and the files ladder that adds a name already taken and a name the server
 * refuses. A hook or a view selects by kind instead of forwarding an adapter's
 * own sentence or inventing a fallback, and each map covers the whole ladder,
 * so adding a kind fails the build here rather than shipping a silent blank.
 */
import type { ProjectFailureKind } from '@/features/workspace/domain/project';
import {
  readFailure,
  type FailureView,
  type FeatureFailureKind,
} from '@/shared/domain/feature-error';

import { FilesError, ProjectError, ProjectImportError, type FilesFailureKind } from './ports';

const FILES_MESSAGES: Readonly<Record<FilesFailureKind, string>> = {
  'outcome-unknown':
    'Could not confirm the file operation. Retry the same action to check its result without repeating it.',
  conflict: 'Something with that name already exists.',
  'invalid-response': 'StashBase returned an unexpected response.',
  rejected: 'That name cannot be used.',
  'scope-lost': 'This project is no longer available in this window.',
  unauthorized: 'This window can no longer access that project.',
  unavailable: 'StashBase is unavailable.',
};

/** A taken name and a refused name are the reader's own request coming back. */
const FILES_INPUT_KINDS: readonly FilesFailureKind[] = ['conflict', 'rejected'];

/** The sentence and tone a refused file mutation shows. Anything that is not a
 *  files failure — a transport that threw, or a bug — reads as the unavailable
 *  line rather than repeating its own message. */
export function filesFailure(error: unknown): FailureView {
  return readFailure<'conflict' | 'rejected' | 'outcome-unknown'>(error, FILES_MESSAGES, {
    inputKinds: FILES_INPUT_KINDS,
  });
}

/** A move is refused for where it was going, not for a name the reader typed. */
export function moveFailure(error: unknown, kind: 'file' | 'folder'): FailureView {
  const view = filesFailure(error);
  if (!(error instanceof FilesError)) return view;
  if (error.kind === 'conflict') {
    return { ...view, message: 'That folder already has an item with this name.' };
  }
  if (error.kind === 'rejected') return { ...view, message: `The ${kind} cannot be moved there.` };
  return view;
}

/** What a refused saved-session read or write reads as. The desktop's own
 *  sentence names a path and travels only as the failure's cause. */
export const SESSION_MESSAGES: Readonly<Record<'load' | 'save', string>> = {
  load: 'StashBase could not read your saved session, so this window starts fresh.',
  save: "StashBase could not save this window's session.",
};

/** A window still holding the project open, and the delay another window may
 *  take to notice one that was removed. */
export const REMOVAL_MESSAGES = {
  blocked: 'A window could not release this project. Resolve its save error and try again.',
  delayed: 'The project was removed. Another window may take a moment to refresh.',
} as const;

/** The project picker reports one outcome the transport ladder cannot: the
 *  desktop could not put a folder chooser on screen at all. */
type ProjectCommandFailureKind = FeatureFailureKind<'fatal'>;

/** The sentence a refused project command shows. The verb names what did not
 *  happen; the kind decides why, so a `ProjectError`'s own transport sentence
 *  never reaches the reader. */
export function projectFailureMessage(
  kind: ProjectFailureKind | 'fatal' | undefined,
  verb: 'opened' | 'removed',
): string {
  const messages: Readonly<Record<ProjectCommandFailureKind, string>> = {
    fatal: `StashBase could not ask for a folder, so no project was ${verb}.`,
    'invalid-response': `StashBase returned an unexpected response, so the project was not ${verb}.`,
    'scope-lost': `That project is no longer in your recent projects, so it could not be ${verb}.`,
    unauthorized: `This window can no longer change your project, so the project was not ${verb}.`,
    unavailable: `The project could not be ${verb}. Check that its folder is available and accessible, then try again.`,
  };
  return messages[kind ?? 'unavailable'];
}

/** Import messages are authored from protocol codes by the import adapter;
 * unrelated exceptions never become user-facing transport prose. */
export function projectEntryFailure(error: unknown, retainedPath: string | null): FailureView {
  if (error instanceof ProjectImportError) {
    return {
      tone: 'input',
      message: error.retainedPath ? `${error.message} ${error.retainedPath}` : error.message,
    };
  }
  return {
    tone: 'capability',
    message: retainedPath
      ? `The project is available at ${retainedPath}. It could not be opened. Try opening it again.`
      : error instanceof ProjectError
        ? projectFailureMessage(error.kind, 'opened')
        : filesFailure(error).message,
  };
}

export const ENTRY_MESSAGES = {
  interrupted: 'Opening the project was interrupted. Try again.',
  failed: 'The project could not be opened. Try again.',
  occupied: 'This window has another project open. Try opening the project again.',
  notReady: 'The project did not become ready. Try opening it again.',
} as const;

export function fileImportFailure(error: unknown): FailureView {
  if (error instanceof FilesError && error.kind === 'scope-lost') return filesFailure(error);
  return {
    message:
      'Could not confirm the import. Check the file list before importing these files again.',
    tone: 'capability',
  };
}
