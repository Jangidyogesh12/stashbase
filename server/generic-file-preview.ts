import fs from 'node:fs';
import path from 'node:path';
import type { GenericFilePreview } from '../shared/project-files.ts';
import { fileStatVersion, MAX_TEXT_READ_BYTES } from './active-file-operations.ts';
import { resolveSafe } from './file-paths.ts';
import { detectViewerFormat, isKnownBinaryFile } from './format.ts';
import { isCloudPlaceholderName } from './indexable.ts';
import { isSpreadsheetFile, spreadsheetFilePreview } from './spreadsheet-preview.ts';

function previewState(
  kind: Exclude<GenericFilePreview['kind'], 'text' | 'spreadsheet'>,
  name: string,
  size?: number,
  message?: string,
): GenericFilePreview {
  return { kind, name, ...(size == null ? {} : { size }), ...(message ? { message } : {}) };
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error != null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
}

/** Strict text admission. Invalid UTF-8, NUL bytes, and a meaningful density
 * of non-whitespace C0 controls are treated as binary rather than decoded
 * lossily into replacement characters. */
export function decodeGenericText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (content.length === 0) return '';
  let controls = 0;
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) controls += 1;
  }
  if (controls > 0 && controls / content.length > 0.01) return null;
  return content;
}

/** Read a generic workspace entry only after the user opens it. This seam is
 * intentionally separate from normal file reads so it cannot widen Search,
 * MCP, save, or automatic Agent-context capabilities. */
export async function readGenericFilePreview(name: string, signal?: AbortSignal): Promise<GenericFilePreview> {
  let target: string;
  try {
    target = resolveSafe(name);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EACCES' || code === 'EPERM') return previewState('unreadable', name);
    throw error;
  }

  let st: fs.Stats;
  try {
    st = fs.lstatSync(target);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EACCES' || code === 'EPERM') return previewState('unreadable', name);
    throw error;
  }

  if (isCloudPlaceholderName(path.basename(target))) {
    return previewState('cloud-placeholder', name, st.size);
  }
  if (st.isSymbolicLink()) return previewState('symlink', name, st.size);
  if (!st.isFile()) return previewState('special', name, st.size);
  if (detectViewerFormat(name)) {
    const error = new Error('known document formats use the document read route') as Error & { status?: number };
    error.status = 415;
    throw error;
  }
  if (isKnownBinaryFile(name) && !isSpreadsheetFile(name)) {
    return previewState('binary', name, st.size);
  }
  if (st.size > MAX_TEXT_READ_BYTES) return previewState('too-large', name, st.size);

  let fd: number | undefined;
  try {
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    fd = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile()) return previewState('special', name, opened.size);
    if (opened.size > MAX_TEXT_READ_BYTES) return previewState('too-large', name, opened.size);
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (isSpreadsheetFile(name)) return await spreadsheetFilePreview(bytes.subarray(0, offset), name, signal);
    const content = decodeGenericText(bytes.subarray(0, offset));
    if (content == null) return previewState('binary', name, opened.size);
    return {
      kind: 'text',
      name,
      size: opened.size,
      content,
      version: fileStatVersion(name) ?? undefined,
    };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') {
      return previewState(code === 'ELOOP' ? 'symlink' : 'unreadable', name, st.size);
    }
    throw error;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}
