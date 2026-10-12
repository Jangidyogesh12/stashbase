import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Hidden sibling temp file, so the rename stays on one filesystem and a
 *  crash leaves a dot-file instead of a half-written target. */
function temporarySibling(file: string): string {
  return path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
}

/** Write `data` to a temp sibling, then rename it over `file`. Creates the
 *  parent directory; removes the temp file when either step fails. */
export function writeFileAtomic(file: string, data: string | Uint8Array, options: { mode?: number } = {}): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = temporarySibling(file);
  try {
    fs.writeFileSync(tmp, data, options.mode === undefined ? undefined : { mode: options.mode });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    throw err;
  }
}

/** Async `writeFileAtomic`. `beforeRename` runs after the bytes are written
 *  and may abort the publish by throwing. */
export async function writeFileAtomicAsync(
  file: string,
  data: string | Uint8Array,
  options: { mode?: number; beforeRename?: () => Promise<void> } = {},
): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = temporarySibling(file);
  try {
    await fs.promises.writeFile(tmp, data, options.mode === undefined ? undefined : { mode: options.mode });
    await options.beforeRename?.();
    await fs.promises.rename(tmp, file);
  } catch (err) {
    try { await fs.promises.rm(tmp, { force: true }); } catch { /* best-effort */ }
    throw err;
  }
}
