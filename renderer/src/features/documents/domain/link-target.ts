import { isExternalSource } from '@/shared/domain/external-source';
import type { SourceReference } from '@/shared/domain/source-reference';

export type DocumentLinkTarget =
  | { kind: 'anchor'; id: string }
  | { anchor?: string; kind: 'source'; source: SourceReference }
  | { href: string; kind: 'external' }
  | { kind: 'ignore' };

function decodeFragment(fragment: string): string | null {
  if (!fragment) return null;
  try {
    const decoded = decodeURIComponent(fragment);
    return decoded.length > 0 && !hasControlCharacter(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}

function explicitExternalLink(raw: string): DocumentLinkTarget | null {
  if (!/^[a-z][a-z\d+.-]*:/iu.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return { kind: 'ignore' };
    }
    return { href: url.href, kind: 'external' };
  } catch {
    return { kind: 'ignore' };
  }
}

/** Resolve one untrusted document href against its owning folder-plus-path identity. */
export function resolveDocumentLink(rawHref: string, owner: SourceReference): DocumentLinkTarget {
  const raw = rawHref.trim();
  if (!raw) return { kind: 'ignore' };
  if (raw.startsWith('#')) {
    const id = decodeFragment(raw.slice(1));
    return id ? { id, kind: 'anchor' } : { kind: 'ignore' };
  }

  const external = explicitExternalLink(raw);
  if (external) return external;
  // An external file's grant covers that file alone, never its neighbours.
  if (isExternalSource(owner)) return { kind: 'ignore' };
  if (raw.startsWith('/') || raw.startsWith('\\') || raw.startsWith('//')) {
    return { kind: 'ignore' };
  }

  const hashIndex = raw.indexOf('#');
  const beforeHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const fragment = hashIndex >= 0 ? raw.slice(hashIndex + 1) : '';
  const queryIndex = beforeHash.indexOf('?');
  const pathPart = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  if (!pathPart) return { kind: 'ignore' };

  const resolved = owner.path.split('/').slice(0, -1);
  for (const encodedSegment of pathPart.split('/')) {
    if (!encodedSegment) return { kind: 'ignore' };
    if (encodedSegment === '.') continue;
    if (encodedSegment === '..') {
      if (resolved.length === 0) return { kind: 'ignore' };
      resolved.pop();
      continue;
    }
    let segment: string;
    try {
      segment = decodeURIComponent(encodedSegment);
    } catch {
      return { kind: 'ignore' };
    }
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      /[\\/]/u.test(segment) ||
      hasControlCharacter(segment)
    ) {
      return { kind: 'ignore' };
    }
    resolved.push(segment);
  }
  if (resolved.length === 0) return { kind: 'ignore' };

  const anchor = decodeFragment(fragment);
  return {
    ...(anchor ? { anchor } : {}),
    kind: 'source',
    source: { folderPath: owner.folderPath, path: resolved.join('/') },
  };
}
