/**
 * Shared resolution of the Python interpreter + sidecar scripts that the
 * Node side spawns (PDF extraction, image OCR). Extracted from `pdf.ts`
 * so `image.ts` and any future converter share one interpreter-discovery
 * path instead of each re-implementing the packaged-vs-dev venv probe.
 *
 * Packaged apps ship no Python interpreter: the index daemon is a bundled
 * PyInstaller binary and the extractor installs on first demand. Development
 * runs the repo's live `.venv.nosync` so built artifacts never shadow source
 * edits.
 */
import { existsSync, statSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDevelopmentRuntime } from './development-runtime.ts';
import { createExtractorRuntime } from './extractor-runtime.ts';
import { appDataRoot } from './local-data.ts';
import { logger } from './log.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = process.env.STASHBASE_APP_ROOT
  ? path.resolve(process.env.STASHBASE_APP_ROOT)
  : path.resolve(__dirname, '..');

export const RESOURCES_ROOT = process.env.STASHBASE_RESOURCES_PATH
  ? path.resolve(process.env.STASHBASE_RESOURCES_PATH)
  : PROJECT_ROOT;
const DEVELOPMENT_RUNTIME = isDevelopmentRuntime();
const extractorRuntime = createExtractorRuntime({
  manifest: async () => JSON.parse(await fs.readFile(path.join(RESOURCES_ROOT, 'python', 'extractor-runtime.json'), 'utf8')),
  root: path.join(appDataRoot(), 'components', 'extractor'),
  onFailure: (error) => logger('extractor-runtime').warn('component download paused:', error),
});

function usesManagedExtractor(): boolean {
  return isPackagedRuntime() && !process.env.STASHBASE_EXTRACT_BIN && !process.env.STASHBASE_PYTHON;
}

export const extractorComponent = {
  async status() {
    return usesManagedExtractor() ? extractorRuntime.status() : { status: 'installed' as const, error: null };
  },
  async retry() {
    return usesManagedExtractor() ? extractorRuntime.retry() : { status: 'installed' as const, error: null };
  },
};

export async function resumeExtractorDownload(): Promise<void> {
  if (usesManagedExtractor()) await extractorRuntime.resume();
}

export const closeExtractorRuntime = () => extractorRuntime.close();

/** Downloads only when actual extraction needs it; cost probes remain cheap.
 * The scheduler releases its native-work lane throughout download and retry. */
export async function prepareExtractorRuntime(
  signal?: AbortSignal,
  yieldLane?: (until?: Promise<unknown>) => Promise<void>,
): Promise<void> {
  if (!usesManagedExtractor()) return;
  signal?.throwIfAborted();
  const installed = extractorRuntime.current();
  if (installed && isFile(installed)) return;
  const installation = extractorRuntime.ensure(signal);
  if (yieldLane) await yieldLane(installation);
  else await installation;
}

/** Absolute path to the Python interpreter to spawn. Honours
 *  `STASHBASE_PYTHON`, then the dev venv populated by `pnpm setup:python`,
 *  then bare `python3`. Packaged apps ship no interpreter; they run the
 *  PyInstaller daemon and extractor binaries instead. */
export function pythonBin(): string {
  if (process.env.STASHBASE_PYTHON) return process.env.STASHBASE_PYTHON;
  const venv = path.join(PROJECT_ROOT, 'python', '.venv.nosync');
  const candidates = process.platform === 'win32'
    ? [path.join(venv, 'Scripts', 'python.exe'), path.join(venv, 'bin', 'python')]
    : [path.join(venv, 'bin', 'python'), path.join(venv, 'Scripts', 'python.exe')];
  return candidates.find((candidate) => existsSync(candidate)) ?? 'python3';
}

/** A PyInstaller --onedir executable: `<root>/<name>/<name>[.exe]`. */
export function sidecarExecutable(root: string, name: string): string {
  return path.join(root, name, process.platform === 'win32' ? `${name}.exe` : name);
}

/** Absolute path to a sidecar script under `python/` (e.g.
 *  `pdf_extract.py`, `ocr_extract.py`). */
function pythonScript(name: string): string {
  const candidates = [
    path.join(RESOURCES_ROOT, 'python', name),
    path.join(PROJECT_ROOT, 'python', name),
  ];
  const script = candidates.find(isFile);
  if (script) return script;
  throw new Error(`Python extractor script not found: ${name}. Looked in: ${candidates.join(', ')}`);
}

/** Resolve how to spawn a one-shot extractor.
 *
 *  Packaged builds have no Python interpreter — the extractor downloads as a
 *  single self-contained PyInstaller binary (`stashbase-extract`) that
 *  dispatches on a `pdf` / `ocr` mode arg (see `python/extract_main.py`).
 *  When `STASHBASE_EXTRACT_BIN` points at it we spawn `<bin> <mode> …`.
 *  In dev there's no binary, so we spawn `<venv python> <script.py> …`.
 *
 *  Returns the command + full arg list ready for `child_process.spawn`. */
export function extractorSpawn(
  mode: 'pdf' | 'ocr',
  scriptName: string,
  args: string[],
): { cmd: string; args: string[] } {
  const bin = process.env.STASHBASE_EXTRACT_BIN || resolvePackagedExtractBin();
  if (bin) return { cmd: bin, args: [mode, ...args] };
  const cmd = pythonBin();
  const script = pythonScript(scriptName);
  if (isPackagedRuntime() && cmd === 'python3') {
    throw new Error(
      'PDF/OCR component is not ready yet.',
    );
  }
  return { cmd, args: [script, ...args] };
}

function resolvePackagedExtractBin(): string | undefined {
  if (DEVELOPMENT_RUNTIME) return undefined;
  if (isPackagedRuntime()) return extractorRuntime.current();
  return [
    sidecarExecutable(path.join(RESOURCES_ROOT, 'python', 'sidecar'), 'stashbase-extract'),
    sidecarExecutable(path.join(PROJECT_ROOT, 'python', 'sidecar.nosync'), 'stashbase-extract'),
  ].find(isFile);
}

function isPackagedRuntime(): boolean {
  return !DEVELOPMENT_RUNTIME && RESOURCES_ROOT !== PROJECT_ROOT;
}

export function isFile(candidate: string): boolean {
  try { return statSync(candidate).isFile(); } catch { return false; }
}
