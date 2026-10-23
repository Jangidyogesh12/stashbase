import { describe, expect, it, vi } from 'vite-plus/test';

import type { HttpClient } from '@/platform/http/client';

import { createGenericFilePreviewAdapter } from './generic-preview-api';

describe('generic file preview API', () => {
  it('loads a bounded preview through its explicit member folder', async () => {
    const client: HttpClient = {
      request: vi.fn(async () => ({
        body: {
          content: 'export const answer = 42;\n',
          kind: 'text',
          name: 'src/answer #1.ts',
          size: 26,
          version: 'sha256:source',
        },
        status: 200,
      })),
    };
    const signal = new AbortController().signal;
    const api = createGenericFilePreviewAdapter(client);

    await expect(
      api.load({ folderPath: '/project/source code', path: 'src/answer #1.ts' }, signal),
    ).resolves.toEqual({
      content: 'export const answer = 42;\n',
      kind: 'text',
      name: 'src/answer #1.ts',
      size: 26,
      version: 'sha256:source',
    });
    expect(client.request).toHaveBeenCalledWith({
      path: '/api/file-preview/src/answer%20%231.ts?folder=%2Fproject%2Fsource+code',
      signal,
    });
  });

  it('rejects mismatched identities and recognizes format-specific viewers', async () => {
    const mismatched = createGenericFilePreviewAdapter({
      request: vi.fn(async () => ({
        body: { content: 'secret', kind: 'text', name: 'other.ts', size: 6 },
        status: 200,
      })),
    });
    await expect(
      mismatched.load(
        { folderPath: '/project/notes', path: 'source.ts' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: 'invalid-response' });

    const formatSpecific = createGenericFilePreviewAdapter({
      request: vi.fn(async () => ({
        body: { error: 'known document formats use the document read route' },
        status: 415,
      })),
    });
    await expect(
      formatSpecific.load(
        { folderPath: '/project/notes', path: 'report.pdf' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: 'not-generic' });
  });

  it('classifies scope loss without exposing transport detail', async () => {
    const api = createGenericFilePreviewAdapter({
      request: vi.fn(async () => ({
        body: { code: 'FOLDER_UNAVAILABLE', error: '/private/folder is gone' },
        status: 410,
      })),
    });

    await expect(
      api.load({ folderPath: '/project/notes', path: 'source.ts' }, new AbortController().signal),
    ).rejects.toMatchObject({
      kind: 'scope-lost',
      message: "The file's project is no longer available in this window.",
    });
  });
});
