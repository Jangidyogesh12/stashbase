import { describe, expect, it } from 'vite-plus/test';

import { externalSource } from '@/shared/domain/external-source';

import { resolveDocumentLink } from './link-target';

const owner = { folderPath: '/project/notes', path: 'guides/current.md' };

describe('document link navigation', () => {
  it('resolves relative files and anchors from the owning source identity', () => {
    expect(resolveDocumentLink('../Other%20note.md#part', owner)).toEqual({
      anchor: 'part',
      kind: 'source',
      source: { folderPath: '/project/notes', path: 'Other note.md' },
    });
    expect(resolveDocumentLink('#R%C3%A9sum%C3%A9', owner)).toEqual({
      id: 'Résumé',
      kind: 'anchor',
    });
  });

  it('retains an out-of-folder source folder instead of rebinding to the active folder', () => {
    expect(
      resolveDocumentLink('sibling.md', {
        folderPath: '/project/archive',
        path: 'guides/current.md',
      }),
    ).toEqual({
      kind: 'source',
      source: { folderPath: '/project/archive', path: 'guides/sibling.md' },
    });
  });

  it('follows no relative link out of an external file, whose grant covers it alone', () => {
    const external = externalSource('grant-token-abcdefghijklmn', '/Users/reader/Desktop/notes.md');
    expect(resolveDocumentLink('sibling.md', external)).toEqual({ kind: 'ignore' });
    expect(resolveDocumentLink('#intro', external)).toEqual({ id: 'intro', kind: 'anchor' });
    expect(resolveDocumentLink('https://example.com/a', external)).toEqual({
      href: 'https://example.com/a',
      kind: 'external',
    });
  });

  it('rejects escapes, encoded separators, credentials, and non-HTTP schemes', () => {
    for (const href of [
      '../../outside.md',
      '..%2Foutside.md',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://person:secret@example.com',
      '//example.com/path',
    ]) {
      expect(resolveDocumentLink(href, owner)).toEqual({ kind: 'ignore' });
    }
  });

  it('allows explicit HTTP(S) URLs and generic local source identities', () => {
    expect(resolveDocumentLink('https://example.com/a', owner)).toEqual({
      href: 'https://example.com/a',
      kind: 'external',
    });
    expect(resolveDocumentLink('../archive.zip', owner)).toEqual({
      kind: 'source',
      source: { folderPath: '/project/notes', path: 'archive.zip' },
    });
  });
});
