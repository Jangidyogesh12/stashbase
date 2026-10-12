/**
 * Deep dispatch module for AppData-derived source formats.
 *
 * Each format owns one `ConversionSpec`; this module iterates them so callers
 * ask for lifecycle operations without repeating format switches, cleanup
 * rules, or interactive-promotion logic.
 */
import fs from 'node:fs';
import {
  collectSourceCandidates,
  currentDerivedTextPath,
  discoverCandidateSources,
  indexFreshDerived,
  isConversionTextUnavailable,
  maybeConvert,
  promoteConversion,
  type ConversionSpec,
} from './conversion.ts';
import { clearRecord } from './conversion-status.ts';
import { DOCX_SPEC } from './docx.ts';
import { filesystemPath } from './filesystem-path.ts';
import { IMAGE_SPEC } from './image.ts';
import { PDF_SPEC } from './pdf.ts';
import type { IndexUpsertResult } from './indexer.ts';

export interface ConvertibleOptions {
  urgency?: 'interactive';
}

export type ConvertibleReprocessResult =
  | { status: 'unsupported' }
  | { status: 'queued' };

const SPECS: readonly ConversionSpec[] = [PDF_SPEC, IMAGE_SPEC, DOCX_SPEC];

export function queueConvertibleSource(
  sourceAbs: string,
  displayName = sourceAbs,
  options: ConvertibleOptions = {},
): boolean {
  const spec = findSpec(displayName);
  if (!spec) return false;
  queue(spec, sourceAbs, options);
  return true;
}

export function reprocessConvertibleSource(
  sourceAbs: string,
  displayName = sourceAbs,
  options: ConvertibleOptions = {},
): ConvertibleReprocessResult {
  const spec = findSpec(displayName);
  if (!spec) return { status: 'unsupported' };
  clearRecord(filesystemPath.absolute(sourceAbs));
  (spec.cleanupBeforeConvert ?? spec.cleanupDerived)?.(sourceAbs);
  queue(spec, sourceAbs, { ...options, urgency: 'interactive' });
  return { status: 'queued' };
}

export function prepareConvertibleSource(sourceAbs: string, displayName = sourceAbs): boolean {
  const spec = findSpec(displayName);
  if (!spec?.interactive) return false;
  const sourcePath = filesystemPath.absolute(sourceAbs);
  if (!promoteConversion(sourcePath, 'interactive')) {
    queue(spec, sourceAbs, { urgency: 'interactive' });
  }
  return true;
}

export async function discoverConvertibleSources(
  folderAbs: string,
  knownCandidates?: readonly string[],
): Promise<void> {
  const candidates = knownCandidates
    ?? await collectSourceCandidates(folderAbs, (candidate) => findSpec(candidate) != null);
  for (const spec of SPECS) await discoverCandidateSources(candidates, spec);
}

export function indexFreshConvertibleSource(
  sourceAbs: string,
  displayName = sourceAbs,
): Promise<IndexUpsertResult | null> {
  const spec = findSpec(displayName);
  return spec ? indexFreshDerived(sourceAbs, spec) : Promise.resolve(null);
}

export async function currentPreparedTextPathAsync(
  sourceAbs: string,
  displayName = sourceAbs,
  known?: { sourceMtimeMs: number; derivedMtimeMs: number },
): Promise<string | null> {
  const spec = findSpec(displayName);
  if (!spec || isConversionTextUnavailable(sourceAbs)) return null;
  try {
    if (!known) {
      const [source, derived] = await Promise.all([
        fs.promises.stat(sourceAbs), fs.promises.stat(spec.derivedNote(sourceAbs)),
      ]);
      if (!source.isFile() || !derived.isFile()) return null;
      known = { sourceMtimeMs: source.mtimeMs, derivedMtimeMs: derived.mtimeMs };
    }
    const current = await currentDerivedTextPath(spec, sourceAbs, known);
    return isConversionTextUnavailable(sourceAbs) ? null : current;
  } catch {
    return null;
  }
}

export function preparedTextCandidatePath(sourceAbs: string, displayName = sourceAbs): string | null {
  return findSpec(displayName)?.derivedNote(sourceAbs) ?? null;
}

function findSpec(candidate: string): ConversionSpec | null {
  return SPECS.find((spec) => spec.matches(candidate)) ?? null;
}

function queue(spec: ConversionSpec, sourceAbs: string, options: ConvertibleOptions): void {
  maybeConvert(sourceAbs, spec, { urgency: options.urgency ?? 'background' });
}
