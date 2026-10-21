import crypto from 'node:crypto';
import path from 'node:path';
import sanitizeHtml from 'sanitize-html';
import { fileStatVersionAsync, readUtf8FileBoundedAsync, resolveAssetAsync } from './active-file-operations.ts';

const LOCAL_ROOT = new URL('http://preview.invalid/__project__/');
const MAX_DEPENDENCIES = 256;

/** HTML dashboards often keep their data in a sibling script. The frame's
 * reload identity includes directly declared local scripts and stylesheets;
 * source/write versions remain independent of these preview dependencies. */
export async function documentAssetVersionAsync(name: string): Promise<string | null> {
  const sourceVersion = await fileStatVersionAsync(name);
  if (!sourceVersion || !['.html', '.htm'].includes(path.extname(name).toLowerCase())) return sourceVersion;
  const absolute = await resolveAssetAsync(name);
  if (!absolute) return null;
  const html = await readUtf8FileBoundedAsync(absolute);
  const documentUrl = new URL(name.split('/').map(encodeURIComponent).join('/'), LOCAL_ROOT);
  let base = documentUrl;
  let hasBase = false;
  const references: string[] = [];
  // Reuse the installed HTML parser's callbacks; the sanitized output is
  // discarded. Raw script text and comments must never become fake tags.
  sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    onOpenTag(tag, attributes) {
      if (tag === 'base' && attributes.href !== undefined && !hasBase) {
        hasBase = true;
        try { base = new URL(attributes.href, documentUrl); } catch { /* invalid base leaves the document URL */ }
      }
      if (tag === 'script' && attributes.src) references.push(attributes.src);
      if (tag === 'link' && attributes.rel?.toLowerCase().split(/\s+/).includes('stylesheet') && attributes.href) {
        references.push(attributes.href);
      }
    },
  });
  const dependencies = new Set<string>();
  for (const reference of references) {
    let url: URL;
    try { url = new URL(reference, base); } catch { continue; }
    if (url.origin !== LOCAL_ROOT.origin || !url.pathname.startsWith(LOCAL_ROOT.pathname)) continue;
    let relative: string;
    try { relative = decodeURIComponent(url.pathname.slice(LOCAL_ROOT.pathname.length)); } catch { continue; }
    dependencies.add(relative);
    if (dependencies.size > MAX_DEPENDENCIES) {
      throw Object.assign(new Error('HTML preview has too many local script and stylesheet references'), { status: 413 });
    }
  }
  const versions = await Promise.all([...dependencies].sort().map(async (relative) =>
    // Existing path authority rejects escapes and symlinks outside this
    // project. Missing resources participate so creation/deletion reloads.
    [relative, await fileStatVersionAsync(relative)],
  ));
  return `html:${crypto.createHash('sha256').update(JSON.stringify([sourceVersion, versions])).digest('hex')}`;
}
