/**
 * Every sentence the review window shows for a domain value. The session
 * stores kinds; the view turns them into words here, and failure sentences
 * come from the application's failure-message module so the two never drift.
 */
import { failureMessage } from '@/features/bug-report/application/failure-messages';
import type {
  ArtifactKind,
  DiagnosticsDetails,
  Notice,
  ReadyPending,
  ReviewArtifact,
  ReviewingPending,
} from '@/features/bug-report/domain/review-session';
import { formatBytes } from '@/shared/utils/format-bytes';

const TITLES: Readonly<Record<ArtifactKind, string>> = {
  diagnostics: 'System info',
  log: 'Application log',
  screenshot: 'Screenshot',
};

export function artifactTitle(kind: ArtifactKind): string {
  return TITLES[kind];
}

const UNAVAILABLE_META = 'Unavailable for this report';

export function artifactMeta(artifact: ReviewArtifact): string {
  const { availability } = artifact;
  if (availability.kind === 'unavailable') return UNAVAILABLE_META;
  const { summary } = availability;
  switch (summary.kind) {
    case 'screenshot':
      return `${summary.width} × ${summary.height} px · ${formatBytes(summary.byteLength)}`;
    case 'log': {
      const truncated = summary.truncated ? ' · most recent entries' : '';
      const plural = summary.redactionCount === 1 ? '' : 's';
      return `${formatBytes(summary.byteLength)}${truncated} · ${summary.redactionCount} redaction${plural}`;
    }
    case 'diagnostics':
      return 'App and OS versions';
  }
}

export const DIAGNOSTIC_ROWS: ReadonlyArray<readonly [string, keyof DiagnosticsDetails]> = [
  ['Captured', 'capturedAt'],
  ['Application', 'appName'],
  ['Version', 'appVersion'],
  ['Mode', 'mode'],
  ['Electron', 'electronVersion'],
  ['Platform', 'platform'],
  ['OS release', 'platformRelease'],
  ['Architecture', 'architecture'],
];

export function noticeText(notice: Notice): string {
  switch (notice.kind) {
    case 'description-updated':
      return 'Report details updated.';
    case 'selection-updated':
      return `${artifactTitle(notice.artifact)} ${notice.included ? 'included' : 'excluded'}.`;
    case 'handoff-complete':
      return notice.via === 'github'
        ? 'Files are in your Downloads folder. Attach them to the GitHub issue.'
        : 'Files are in your Downloads folder.';
    case 'failed':
      return failureMessage(notice.failure.kind);
  }
}

export function reviewingPendingText(pending: ReviewingPending): string | null {
  if (pending === null) return null;
  return pending.kind === 'description' ? 'Saving report details…' : 'Updating selection…';
}

const READY_PENDING: Readonly<Record<NonNullable<ReadyPending>, string>> = {
  download: 'Saving the files to Downloads…',
  'open-github': 'Saving the files to Downloads and opening GitHub…',
  reopen: 'Reopening the review…',
  retry: 'Checking and preparing the report…',
};

export function readyPendingText(pending: ReadyPending): string | null {
  return pending === null ? null : READY_PENDING[pending];
}

export const PREPARING_TEXT = 'Checking and preparing the report…';
export const LOADING_TEXT = 'Loading the report…';
export const UNPREPARED_TEXT = 'The report is approved. Select Retry to prepare its attachments.';
