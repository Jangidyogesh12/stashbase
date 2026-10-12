/** One lazy, shared PDF/OCR component installation per server. Callers retain
 * their own cancellation; no source bytes or provider credentials are sent. */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';
import { nativeComponentUnavailable } from './native-component-support.ts';
import { extractorDownloadUrl, extractorManifestSchema, type ExtractorManifest } from '../shared/extractor-runtime.ts';

import type { LocalComponentStatusWire } from '../shared/protocols/http/local-components.ts';

const MAX_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 50_000;

export interface ExtractorRuntimeOptions {
  manifest: () => Promise<unknown>;
  root: string;
  platform?: NodeJS.Platform;
  arch?: string;
  osRelease?: string;
  fetch?: typeof fetch;
  onFailure?: (error: unknown) => void;
}

/** Hash-verified archives are still confined to staging, including symlinks. */
export async function unpackExtractor(archive: string, destination: string): Promise<void> {
  let bytes = 0;
  let entries = 0;
  let invalid: Error | undefined;
  await tar.x({
    file: archive, cwd: destination, strict: true, preservePaths: false,
    filter: (name, entry) => {
      if (invalid || !('type' in entry)) return false;
      try {
        const normalized = name.replace(/\/$/, '');
        const parts = normalized.split('/');
        if (parts[0] !== 'stashbase-extract' || parts.some((part) => !part || part === '.' || part === '..')
          || /[\\:\x00]/.test(name)) throw new Error('Invalid extractor archive path');
        if (!['File', 'Directory', 'SymbolicLink'].includes(entry.type)) throw new Error('Invalid extractor archive entry');
        if (++entries > MAX_ENTRIES || (bytes += entry.size) > MAX_EXPANDED_BYTES) throw new Error('Extractor archive exceeds bounds');
        if (entry.type === 'SymbolicLink') {
          const link = entry.linkpath ?? '';
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(normalized), link));
          if (!link || /[\\:\x00]/.test(link) || path.posix.isAbsolute(link)
            || !target.startsWith('stashbase-extract/')) throw new Error('Extractor archive link escapes component');
        }
        return true;
      } catch (error) {
        invalid = error instanceof Error ? error : new Error(String(error));
        return false;
      }
    },
  });
  if (invalid) throw invalid;
}

export function createExtractorRuntime(options: ExtractorRuntimeOptions) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const unavailable = nativeComponentUnavailable(platform, arch, options.osRelease);
  const request = options.fetch ?? fetch;
  const requested = path.join(options.root, 'requested.json');
  let ready: string | undefined;
  let status: LocalComponentStatusWire = { status: 'not-installed', error: null };
  let automaticAttempted = false;
  let componentDemand = false;
  let shutdownDemand = false;
  let demandWrites = Promise.resolve();
  let closed = false;
  let initialized: Promise<void> | undefined;
  let active: { controller: AbortController; completion: Promise<void>; background: boolean } | undefined;
  type Waiter = { resolve: (bin: string) => void; reject: (error: unknown) => void; cancelled?: boolean };
  const waiters = new Set<Waiter>();

  // Serialize demand publication with cancellation. A new waiter arriving during
  // removal must restore its own next-launch demand after the old removal finishes.
  function persistDemand(): Promise<void> {
    const next = demandWrites.catch(() => {}).then(async () => {
      if (!ready && ([...waiters].some((waiter) => !waiter.cancelled) || componentDemand || shutdownDemand)) {
        await fs.mkdir(options.root, { recursive: true, mode: 0o700 });
        await fs.writeFile(requested, '{}', { mode: 0o600 });
      } else {
        await fs.rm(requested, { force: true });
      }
    });
    demandWrites = next;
    return next;
  }

  async function readManifest() {
    const manifest = extractorManifestSchema.parse(await options.manifest());
    if (manifest.platform !== platform || manifest.arch !== arch) throw new Error('Extractor platform mismatch');
    extractorDownloadUrl(manifest);
    return manifest;
  }

  async function installed(manifest: ExtractorManifest): Promise<string | undefined> {
    const target = path.join(options.root, manifest.sha256);
    const executable = path.join(target, 'stashbase-extract', platform === 'win32' ? 'stashbase-extract.exe' : 'stashbase-extract');
    try {
      const marker = JSON.parse(await fs.readFile(path.join(target, 'installed.json'), 'utf8'));
      if (marker.sha256 === manifest.sha256 && (await fs.stat(executable)).isFile()) return executable;
    } catch { /* absent or incomplete installation */ }
    return undefined;
  }

  function initialize(): Promise<void> {
    return initialized ??= (async () => {
      if (unavailable) {
        status = { status: 'failed', error: 'unsupported-system' };
        return;
      }
      try {
        ready = await installed(await readManifest());
        if (ready) status = { status: 'installed', error: null };
      } catch (error) { status = { status: 'failed', error: 'manifest' }; options.onFailure?.(new Error('Extractor manifest initialization failed', { cause: error })); }
    })();
  }

  function startAttempt(background: boolean): void {
    if (closed || ready || unavailable) return;
    if (background) {
      componentDemand = true;
      if (active) active.background = true;
    }
    if (active) return;
    automaticAttempted = true;
    status = { status: 'downloading', error: null };
    const flight = { controller: new AbortController(), completion: Promise.resolve(), background };
    active = flight;
    const signal = flight.controller.signal;
    flight.completion = (async () => {
      let staging: string | undefined;
      let failure: NonNullable<LocalComponentStatusWire['error']> = 'installation';
      try {
        // A durable demand latch lets the next app launch try once even if
        // the project is not reopened. Merely reading Settings never sets it.
        await persistDemand();
        failure = 'manifest';
        const manifest = await readManifest();
        ready = await installed(manifest);
        if (!ready) {
          failure = 'installation';
          for (const entry of await fs.readdir(options.root)) {
            const pid = Number(entry.match(/^\.staging-(\d+)-/)?.[1]);
            if (!pid) continue;
            try { process.kill(pid, 0); }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ESRCH') await fs.rm(path.join(options.root, entry), { recursive: true, force: true });
            }
          }
          signal.throwIfAborted();
          staging = await fs.mkdtemp(path.join(options.root, `.staging-${process.pid}-`));
          const archive = path.join(staging, 'component.tar.gz');
          failure = 'network';
          await download(manifest, extractorDownloadUrl(manifest), archive, signal, request);
          signal.throwIfAborted();
          failure = 'installation';
          const expanded = path.join(staging, 'expanded');
          await fs.mkdir(expanded);
          await unpackExtractor(archive, expanded);
          signal.throwIfAborted();
          const exe = platform === 'win32' ? 'stashbase-extract.exe' : 'stashbase-extract';
          const bin = path.join(expanded, 'stashbase-extract', exe);
          if (!(await fs.lstat(bin)).isFile()) throw new Error('Extractor executable is missing');
          if (platform !== 'win32') await fs.chmod(bin, 0o755);
          await fs.writeFile(path.join(expanded, 'installed.json'), JSON.stringify({ sha256: manifest.sha256 }));
          const target = path.join(options.root, manifest.sha256);
          await fs.rm(target, { recursive: true, force: true });
          await fs.rename(expanded, target);
          ready = path.join(target, 'stashbase-extract', exe);
        }
        await fs.rm(requested, { force: true });
        status = { status: 'installed', error: null };
      } catch (error) {
        ready = undefined;
        status = { status: 'failed', error: signal.aborted ? 'interrupted'
          : error instanceof DownloadVerificationError ? 'verification' : failure };
        if (!signal.aborted) options.onFailure?.(error);
        // Waiters retain their task identity and released lane. Only Retry or
        // the next process's automatic allowance can start another attempt.
      } finally {
        if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
        if (active === flight) active = undefined;
        if (ready && status.status === 'installed') {
          for (const waiter of waiters) waiter.resolve(ready);
        }
      }
    })();
  }

  return {
    current: () => ready,
    async status(): Promise<LocalComponentStatusWire> {
      await initialize();
      return { ...status };
    },
    async resume(): Promise<void> {
      await initialize();
      if (await fs.access(requested).then(() => true, () => false) && !automaticAttempted) startAttempt(true);
    },
    async retry(): Promise<LocalComponentStatusWire> {
      await initialize();
      if (active && status.status !== 'downloading') await active.completion;
      startAttempt(true);
      return { ...status };
    },
    async ensure(signal?: AbortSignal): Promise<string> {
      await initialize();
      signal?.throwIfAborted();
      if (closed) throw new Error('Extractor runtime is closed');
      if (unavailable) throw new Error(unavailable);
      if (ready && await fs.stat(ready).then((stat) => stat.isFile(), () => false)) return ready;
      signal?.throwIfAborted();
      ready = undefined;
      if (status.status === 'installed') status = { status: 'failed', error: 'installation' };
      if (active?.controller.signal.aborted) await active.completion;
      signal?.throwIfAborted();
      let waiter!: Waiter;
      const completion = new Promise<string>((resolve, reject) => { waiter = { resolve, reject }; });
      const abort = () => {
        if (signal?.reason === 'shutdown') shutdownDemand = true;
        else waiter.cancelled = true;
        waiter.reject(signal?.reason ?? new Error('Extractor preparation cancelled'));
      };
      waiters.add(waiter);
      signal?.addEventListener('abort', abort, { once: true });
      if (!automaticAttempted) startAttempt(false);
      else void persistDemand().catch(waiter.reject);
      try { return await completion; }
      finally {
        signal?.removeEventListener('abort', abort);
        waiters.delete(waiter);
        if (!waiters.size && active && !active.background && !ready) {
          active.controller.abort();
          await active.completion;
        }
        if (signal?.aborted && signal.reason !== 'shutdown' && !componentDemand) {
          await persistDemand();
        }
      }
    },
    async close(): Promise<void> {
      shutdownDemand ||= [...waiters].some((waiter) => !waiter.cancelled);
      closed = true;
      for (const waiter of waiters) waiter.reject(new Error('Extractor runtime closed'));
      active?.controller.abort();
      await active?.completion;
      await demandWrites;
    },
  };
}

class DownloadVerificationError extends Error {}

async function download(
  manifest: ExtractorManifest, url: string, destination: string, signal: AbortSignal, request: typeof fetch,
): Promise<void> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout>;
  const armTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error('Extractor download stalled')), 30_000);
    timer.unref();
  };
  armTimeout();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let file: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const response = await request(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`Extractor download HTTP ${response.status}`);
    reader = response.body.getReader();
    file = await fs.open(destination, 'wx', 0o600);
    const hash = crypto.createHash('sha256');
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armTimeout();
      signal.throwIfAborted();
      received += value.byteLength;
      if (received > manifest.sizeBytes) throw new DownloadVerificationError('Extractor download exceeds expected size');
      hash.update(value);
      await file.writeFile(value);
    }
    if (received !== manifest.sizeBytes || hash.digest('hex') !== manifest.sha256) throw new DownloadVerificationError('Extractor checksum mismatch');
    await file.sync();
  } finally {
    clearTimeout(timer!);
    controller.abort();
    signal.removeEventListener('abort', abort);
    await reader?.cancel().catch(() => {});
    await file?.close();
  }
}
