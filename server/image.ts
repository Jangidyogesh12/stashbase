/**
 * Image → OCR-text note conversion, driven by `python/ocr_extract.py`.
 *
 * The image analogue of `pdf.ts`: whenever a `.png` / `.jpg` / `.jpeg`
 * / `.webp` lands in a folder (file import or an external copy)
 * we spawn RapidOCR in the background. It writes OCR Markdown under AppData;
 * on completion the note is admitted to the index directly — so a screenshot's text becomes searchable. The image itself
 * stays on disk as the user-facing file.
 *
 * Unlike PDFs there is no image bundle — OCR yields only text.
 *
 * Conversion status reuses the same `state.db`-backed store as PDFs
 * (`conversion-status.ts`, keyed by path) so search readiness and persistent
 * failures cover images and PDFs through one path.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { isImageFile } from './format.ts';
import { derivedNoteFor, derivedDir } from './derived-store.ts';
import { prepareExtractorRuntime } from './python-host.ts';
import { TransientConversionError, type ConversionSpec } from './conversion.ts';
import { runExtractor } from './extractor-process.ts';

/** Run the OCR extractor on a single image. Resolves with the AppData note
 *  path (the OCR text layer; there is no image bundle) on success; rejects
 *  with the extractor's stderr tail on failure. */
async function convertImage(
  imageAbsPath: string,
  _onProgress?: unknown,
  signal?: AbortSignal,
  yieldLane?: (until?: Promise<unknown>) => Promise<void>,
): Promise<{ notePath: string }> {
  await prepareExtractorRuntime(signal, yieldLane);
  signal?.throwIfAborted();
  const notePath = derivedNoteFor(imageAbsPath);
  mkdirSync(derivedDir(), { recursive: true });
  const { code, signal: exitSignal, cancelled, stderrTail, stderr } = await runExtractor({
    mode: 'ocr',
    script: 'ocr_extract.py',
    args: [imageAbsPath, notePath],
    signal,
  });
  if (cancelled) throw new TransientConversionError('ocr_extract cancelled');
  if (code === 0) return { notePath };
  if (isMissingRapidOcrError(stderrTail)) {
    throw Object.assign(new Error(
      'OCR engine is not installed. Run `pnpm setup:python-extract` and restart StashBase; the image still opens, but its text cannot be searched until OCR is available.',
    ), { exit_code: code, signal: exitSignal, stderr: stderr ?? stderrTail });
  }
  throw Object.assign(new Error(`ocr_extract ${exitSignal ? `signal ${exitSignal}` : `exit ${code}`}: ${stderrTail || '(no stderr)'}`),
    { exit_code: code, signal: exitSignal, stderr: stderr ?? stderrTail });
}

/** Conversion spec wiring images into the shared `conversion.ts` plumbing.
 *  Unlike PDFs there's no image bundle — OCR yields only the text note. */
export const IMAGE_SPEC: ConversionSpec = {
  kind: 'ocr_extract',
  lane: 'heavy',
  cost: 10,
  matches: isImageFile,
  derivedNote: derivedNoteFor,
  completeMarker: { text: '<!-- stashbase-ocr-conversion: complete -->', tailBytes: 2048 },
  convert: convertImage,
  cleanupDerived: (imageAbsPath) => rmSync(derivedNoteFor(imageAbsPath), { force: true }),
};

function isMissingRapidOcrError(message: string): boolean {
  return /rapidocr_onnxruntime/i.test(message)
    || /No module named ['"][^'"]*rapidocr/i.test(message)
    || /OCR dependency rapidocr/i.test(message);
}
