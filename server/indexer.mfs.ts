/**
 * Indexer impl backed by the Python MFS sidecar. Each method translates
 * a logical op into one JSON request and reshapes the reply to match
 * the `Indexer` contract. The `Indexer` API speaks absolute POSIX-spelled
 * source paths; this module is the daemon boundary and sends Node-generated
 * comparison identities separately wherever Python needs routing keys. The
 * daemon maps each absolute Folder root to one MFS Internal namespace and
 * converts source paths to namespace-relative DocumentIds.
 *
 * HTML special-case: we feed MFS a markdown-shaped plaintext (see
 * `server/html.ts:analyzeHtml`) so its markdown chunker keeps respecting
 * heading boundaries even though it has no HTML parser. The on-disk
 * file extension stays `.html` — only what we send to the indexer is
 * rewritten. JSON and UTF-8 TXT are passed through byte-for-text unchanged so
 * the generic text chunker handles them without parsing or serialization.
 */
import { analyzeHtml } from './html.ts';
import { detectFormat } from './format.ts';
import { contentSizeError, shouldIndexSourcePath } from './indexable.ts';
import { logger } from './log.ts';
import { getDaemon } from './mfs-daemon.ts';
import { filesystemPath } from './filesystem-path.ts';
import type {
  EmbedderRuntimeConfig,
  ExactSearchOptions,
  ExactSearchResult,
  IndexUpsertResult,
  Indexer,
  IndexerStatus,
  SearchHit,
} from './indexer.ts';

const log = logger('index');

// Node remains the owner of platform and Unicode path identity. Python receives
// both retained spelling and opaque comparison identity at every path crossing.
const normalizeDaemonPath = (p: string): string => filesystemPath.absolute(p);

/** Build the complete text projection handed to MFS. MFS owns its content
 * identity and unchanged decision. */
export function prepareForIndex(filePath: string, content: string): string {
  const format = detectFormat(filePath);
  if (format === 'html') {
    // HTML is structured (the .html file is the source of truth), but
    // MFS's chunker splits on markdown headings — so we run a cheap,
    // in-memory "targeted optimization" that turns <h1-6> into `#`
    // headings + flattened body. Done here at feed time (not materialized
    // to a hidden .md) because the transform is cheap and the source HTML
    // already covers viewing. PDF/images use durable prepared Markdown;
    // DOCX uses prepared HTML. Their format owners cache these expensive
    // conversions outside the visible project.
    const { plaintext } = analyzeHtml(content);
    return plaintext;
  }
  // Markdown, JSON, and TXT already are the directly readable source of truth.
  return content;
}

interface DaemonHit {
  path: string;
  chunk_index: number;
  chunk_text: string;
  start_line?: number;
  end_line?: number;
  score: number;
  metadata?: Record<string, unknown>;
}

interface DaemonGrepMatch {
  line: number;
  text: string;
  ranges: Array<[number, number]>;
}

interface DaemonGrepFile {
  path: string;
  matches: DaemonGrepMatch[];
  total_matches: number;
}

const EXACT_MAX_LINE_CHARS = 240;

function grepSnippet(match: DaemonGrepMatch): DaemonGrepMatch {
  const { text, ranges } = match;
  let windowStart = 0;
  if (text.length > EXACT_MAX_LINE_CHARS && ranges.length > 0) {
    windowStart = Math.max(0, Math.min(
      text.length - EXACT_MAX_LINE_CHARS,
      (ranges[0]?.[0] ?? 0) - Math.floor(EXACT_MAX_LINE_CHARS / 3),
    ));
  }
  const windowEnd = Math.min(text.length, windowStart + EXACT_MAX_LINE_CHARS);
  const leading = windowStart > 0 ? '…' : '';
  const trailing = windowEnd < text.length ? '…' : '';
  const snippet = leading + text.slice(windowStart, windowEnd) + trailing;
  return {
    line: match.line,
    text: snippet,
    ranges: ranges.flatMap(([start, end]) => {
      const localStart = start - windowStart + leading.length;
      const localEnd = end - windowStart + leading.length;
      if (localEnd <= leading.length || localStart >= snippet.length - trailing.length) return [];
      return [[
        Math.max(leading.length, localStart),
        Math.min(snippet.length - trailing.length, localEnd),
      ] as [number, number]];
    }),
  };
}

export class MfsIndexer implements Indexer {
  private loggedBindings = new Map<string, string>();
  /** Cleanup for a Folder that was never bound cannot have an MFS row to
   * remove. Avoid spawning the daemon only to turn that idempotent case into
   * a binding error. */
  private hasBindingFor(sourcePath: string): boolean {
    const source = normalizeDaemonPath(sourcePath);
    for (const folder of getDaemon().knownBindings().keys()) {
      if (filesystemPath.relative(folder, source) !== null) return true;
    }
    return false;
  }

  async bindFolder(folder: string, cfg: EmbedderRuntimeConfig): Promise<void> {
    const daemon = getDaemon();
    const source = normalizeDaemonPath(folder);
    const key = filesystemPath.identity(source);
    await daemon.bindFolder(source, {
      provider: cfg.provider,
      apiKey: cfg.apiKey,
      model: cfg.model,
      dimension: cfg.dimension,
      baseUrl: cfg.baseUrl,
    });
    const bindingKey = `${cfg.provider}:${cfg.model ?? ''}:${cfg.dimension ?? ''}:${cfg.baseUrl ?? ''}`;
    if (this.loggedBindings.get(key) === bindingKey) {
      log.debug(`bound ${source} → ${cfg.provider}`);
    } else {
      this.loggedBindings.set(key, bindingKey);
      log.info(`bound ${source} → ${cfg.provider}`);
    }
  }

  async unbindFolder(folder: string): Promise<void> {
    const source = normalizeDaemonPath(folder);
    const key = filesystemPath.identity(source);
    await getDaemon().unbindFolder(source);
    this.loggedBindings.delete(key);
  }

  async upsertFile(filePath: string, content: string, options?: { waitForIndex?: boolean }): Promise<IndexUpsertResult> {
    if (!shouldIndexSourcePath(filePath)) {
      await getDaemon().call('delete', {
        path: normalizeDaemonPath(filePath),
        path_identity: filesystemPath.identity(filePath),
      });
      log.info(`upsert ${filePath}: skipped by index rules`);
      return { outcome: 'removed' };
    }
    const tooLarge = contentSizeError(content);
    if (tooLarge) {
      await getDaemon().call('delete', {
        path: normalizeDaemonPath(filePath),
        path_identity: filesystemPath.identity(filePath),
      });
      log.info(`upsert ${filePath}: ${tooLarge}`);
      return { outcome: 'removed' };
    }
    const text = prepareForIndex(filePath, content);
    // Covers truly empty files AND files whose extractable text is empty
    // (bundler-format HTML that is one giant <script>, whitespace-only
    // notes) — embedding either would store 0 chunks, so skip the
    // round-trip. `/api/index-status` filters the same files out of
    // `pending` (see `hasNoExtractableText`) so they don't pulse forever.
    if (text.trim().length === 0) {
      await getDaemon().call('delete', {
        path: normalizeDaemonPath(filePath),
        path_identity: filesystemPath.identity(filePath),
      });
      log.info(`upsert ${filePath}: no extractable text, skipped embedding`);
      return { outcome: 'removed' };
    }
    const t0 = Date.now();
    const res = await getDaemon().call<IndexUpsertResult & { total_ms: number }>(
      'upsert', {
        path: normalizeDaemonPath(filePath),
        path_identity: filesystemPath.identity(filePath),
        content: text,
        wait_for_index: options?.waitForIndex ?? true,
      },
    );
    log.info(
      `upsert ${filePath}: ${res.outcome} ` +
        `(MFS ${fmtMs(res.total_ms)}, wall ${fmtMs(Date.now() - t0)})`,
    );
    return { outcome: res.outcome };
  }

  async upsertConvertedFile(sourceAbs: string, derivedContent: string, derivedExt = '.md'): Promise<IndexUpsertResult> {
    // Convertible sources: the searchable text is stored in AppData, but
    // indexed UNDER the source's own path so folder-scoped search finds it.
    // HTML-derived DOCX content is
    // flattened with the same transform as source HTML before we feed MFS.
    const ext = derivedExt.toLowerCase();
    const content = ext === '.html' || ext === '.htm'
      ? analyzeHtml(derivedContent).plaintext
      : derivedContent;
    const tooLarge = contentSizeError(content);
    if (content.trim().length === 0 || tooLarge) {
      await getDaemon().call('delete', {
        path: normalizeDaemonPath(sourceAbs),
        path_identity: filesystemPath.identity(sourceAbs),
      });
      if (tooLarge) log.info(`upsert(converted) ${sourceAbs}: ${tooLarge}`);
      return { outcome: 'removed' };
    }
    const res = await getDaemon().call<IndexUpsertResult & { total_ms: number }>(
      'upsert', {
        path: normalizeDaemonPath(sourceAbs),
        path_identity: filesystemPath.identity(sourceAbs),
        content,
        wait_for_index: false,
      },
    );
    log.info(`upsert(converted) ${sourceAbs}: ${res.outcome} (MFS ${fmtMs(res.total_ms)})`);
    return { outcome: res.outcome };
  }

  async deleteFile(filePath: string): Promise<void> {
    if (!this.hasBindingFor(filePath)) return;
    await getDaemon().call('delete', {
      path: normalizeDaemonPath(filePath),
      path_identity: filesystemPath.identity(filePath),
    });
  }

  async deletePathPrefix(prefix: string): Promise<void> {
    if (!this.hasBindingFor(prefix)) return;
    const norm = normalizeDaemonPath(prefix);
    const res = await getDaemon().call<{ removed: number }>(
      'delete_prefix', { prefix: norm, prefix_identity: filesystemPath.identity(prefix) },
    );
    log.info(`delete_prefix ${prefix}: removed ${res.removed} document(s) from index`);
  }

  async renameFile(oldPath: string, newPath: string, content: string): Promise<void> {
    await this.deleteFile(oldPath);
    await this.upsertFile(newPath, content);
  }

  async renamePathPrefix(
    oldPrefix: string,
    newPrefix: string,
    files: Array<{ path: string; content: string }>,
  ): Promise<void> {
    const oldRoot = normalizeDaemonPath(oldPrefix);
    const newRoot = normalizeDaemonPath(newPrefix);
    await this.deletePathPrefix(oldRoot);
    for (const file of files) {
      const rel = filesystemPath.relative(oldRoot, normalizeDaemonPath(file.path));
      if (rel == null || rel === '') {
        throw new Error(`rename source is outside prefix: ${file.path}`);
      }
      await this.upsertFile(filesystemPath.join(newRoot, rel), file.content);
    }
  }

  async search(query: string, topK: number, folder: string, pathPrefix?: string, extensions?: string[]): Promise<SearchHit[]> {
    const args: Record<string, unknown> = {
      query,
      top_k: topK,
      folder: normalizeDaemonPath(folder),
    };
    if (pathPrefix) args.path_prefix = normalizeDaemonPath(pathPrefix);
    if (extensions && extensions.length > 0) args.extensions = extensions;
    const res = await getDaemon().call<{ hits: DaemonHit[] }>('search', args);
    return res.hits.map((h) => ({
      fileName: normalizeDaemonPath(h.path),
      chunkIndex: h.chunk_index,
      content: h.chunk_text,
      // MFS markdown chunker stuffs heading info into metadata; lift it
      // to a top-level `heading` field so the external SearchHit contract
      // stays format-agnostic.
      heading: typeof h.metadata?.heading_text === 'string'
        ? (h.metadata.heading_text as string)
        : '',
      startLine: h.start_line,
      endLine: h.end_line,
      score: h.score,
    }));
  }

  async grep(query: string, folder: string, options: ExactSearchOptions): Promise<ExactSearchResult> {
    const args: Record<string, unknown> = {
      query,
      folder: normalizeDaemonPath(folder),
      case_strict: options.caseStrict,
      whole_word: options.wholeWord,
    };
    if (options.pathPrefix) args.path_prefix = normalizeDaemonPath(options.pathPrefix);
    if (options.extensions?.length) args.extensions = options.extensions;
    const result = await getDaemon().call<{
      files: DaemonGrepFile[];
      total_matches: number;
      truncated: boolean;
    }>('grep', args);
    return {
      files: result.files.map((file) => ({
        path: file.path,
        totalMatches: file.total_matches,
        matches: file.matches.map(grepSnippet),
      })),
      totalMatches: result.total_matches,
      truncated: result.truncated,
    };
  }

  async status(folder?: string): Promise<IndexerStatus> {
    // Per-folder status comes directly from MFS accepted document revisions,
    // which keeps Node from maintaining a second partial cache that can drift
    // from the vector store.
    const args: Record<string, unknown> = {};
    if (folder) args.folder = normalizeDaemonPath(folder);
    const res = await getDaemon().call<{
      total: number;
      indexed: number;
      pending_count: number;
      pending: string[];
      orphaned_count: number;
      orphaned: string[];
      up_to_date: boolean;
    }>('status', args);
    return {
      total: res.total,
      indexed: res.indexed,
      pendingCount: res.pending_count,
      pending: res.pending.map(normalizeDaemonPath),
      orphanedCount: res.orphaned_count,
      orphaned: res.orphaned.map(normalizeDaemonPath),
      upToDate: res.up_to_date,
      indexReady: true,
    };
  }

  async listDocuments(folder?: string): Promise<string[]> {
    const args: Record<string, unknown> = {};
    if (folder) args.folder = normalizeDaemonPath(folder);
    const res = await getDaemon().call<{ documents: string[] }>('list_documents', args);
    return res.documents.map(normalizeDaemonPath);
  }

  async closeStore(): Promise<void> {
    const daemon = getDaemon();
    if (daemon.currentGeneration() === 0) return;
    try {
      await daemon.call('close_store', {});
    } finally {
      await daemon.close();
    }
  }

  async close(): Promise<void> {
    await getDaemon().close();
  }
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
