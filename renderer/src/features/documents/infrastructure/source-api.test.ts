import { describe, expect, it, vi } from 'vite-plus/test';

import type { HttpClient } from '@/platform/http/client';

import { createDocumentSourceAdapter } from './source-api';

describe('document source API', () => {
  it('loads explicit-folder Markdown and retains the byte version', async () => {
    const client: HttpClient = {
      request: vi.fn(async () => ({
        body: {
          content: '# Plan\n',
          format: 'md',
          name: 'drafts/plan #1.markdown',
          version: 'sha256:abc',
        },
        status: 200,
      })),
    };
    const signal = new AbortController().signal;
    const api = createDocumentSourceAdapter(client);

    await expect(
      api.load({ folderPath: '/project/research notes', path: 'drafts/plan #1.markdown' }, signal),
    ).resolves.toEqual({ content: '# Plan\n', format: 'md', version: 'sha256:abc' });
    expect(client.request).toHaveBeenCalledWith({
      path: '/api/files/drafts/plan%20%231.markdown?folder=%2Fproject%2Fresearch+notes',
      signal,
    });
  });

  it('keeps invalid UTF-8 TXT explicit and never returns replacement text', async () => {
    const api = createDocumentSourceAdapter({
      request: vi.fn(async () => ({
        body: {
          content: '',
          error: { code: 'UNSUPPORTED_ENCODING', message: 'private server detail' },
          format: 'txt',
          name: 'legacy.txt',
          version: 'sha256:def',
        },
        status: 200,
      })),
    });

    await expect(
      api.load({ folderPath: '/project/notes', path: 'legacy.txt' }, new AbortController().signal),
    ).rejects.toMatchObject({
      kind: 'unsupported-encoding',
      message: 'This text file is not valid UTF-8. It remains unchanged and read-only.',
    });
  });

  it('rejects mismatched identities and classifies lost folder scope', async () => {
    const mismatched = createDocumentSourceAdapter({
      request: vi.fn(async () => ({
        body: { content: 'wrong', format: 'txt', name: 'other.txt', version: 'v1' },
        status: 200,
      })),
    });
    await expect(
      mismatched.load(
        { folderPath: '/project/notes', path: 'notes.txt' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: 'invalid-response' });

    const lost = createDocumentSourceAdapter({
      request: vi.fn(async () => ({
        body: { code: 'FOLDER_UNAVAILABLE', error: 'private server detail' },
        status: 410,
      })),
    });
    await expect(
      lost.load({ folderPath: '/project/notes', path: 'notes.txt' }, new AbortController().signal),
    ).rejects.toMatchObject({
      kind: 'scope-lost',
      message: "The document's project is no longer available in this window.",
    });
  });

  it('rejects an invalid source identity before transport', async () => {
    const client: HttpClient = { request: vi.fn() };
    const api = createDocumentSourceAdapter(client);

    await expect(
      api.load({ folderPath: ' ', path: 'notes.txt' }, new AbortController().signal),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'The document identity is invalid.',
    });
    expect(client.request).not.toHaveBeenCalled();
  });

  it('saves through the explicit folder and expected source version', async () => {
    const client: HttpClient = {
      request: vi.fn(async () => ({
        body: {
          content: '# Changed\r\n',
          format: 'md',
          name: 'drafts/plan #1.markdown',
          version: 'sha256:after',
        },
        status: 200,
      })),
    };
    const signal = new AbortController().signal;
    const api = createDocumentSourceAdapter(client);

    await expect(
      api.save(
        { folderPath: '/project/research notes', path: 'drafts/plan #1.markdown' },
        { baseVersion: 'sha256:before', content: '# Changed\n' },
        signal,
      ),
    ).resolves.toEqual({ content: '# Changed\r\n', format: 'md', version: 'sha256:after' });
    expect(client.request).toHaveBeenCalledWith({
      body: { baseVersion: 'sha256:before', content: '# Changed\n' },
      method: 'PUT',
      path: '/api/files/drafts/plan%20%231.markdown?folder=%2Fproject%2Fresearch+notes',
      signal,
    });
  });

  it('loads and saves JSON through the same versioned text authority', async () => {
    const client: HttpClient = {
      request: vi
        .fn<HttpClient['request']>()
        .mockResolvedValueOnce({
          body: {
            content: '{"value": 1}\r\n',
            format: 'json',
            name: 'data.json',
            version: 'sha256:before',
          },
          status: 200,
        })
        .mockResolvedValueOnce({
          body: {
            content: '{"value": 2}\r\n',
            format: 'json',
            name: 'data.json',
            version: 'sha256:after',
          },
          status: 200,
        }),
    };
    const api = createDocumentSourceAdapter(client);
    const source = { folderPath: '/project/notes', path: 'data.json' };
    const signal = new AbortController().signal;

    await expect(api.load(source, signal)).resolves.toEqual({
      content: '{"value": 1}\r\n',
      format: 'json',
      version: 'sha256:before',
    });
    await expect(
      api.save(source, { baseVersion: 'sha256:before', content: '{"value": 2}\n' }, signal),
    ).resolves.toEqual({
      content: '{"value": 2}\r\n',
      format: 'json',
      version: 'sha256:after',
    });
  });

  it('overwrites only through the explicit conflict-decision request', async () => {
    const client: HttpClient = {
      request: vi.fn(async () => ({
        body: {
          content: '# Editor draft\r\n',
          format: 'md',
          name: 'plan.md',
          version: 'sha256:overwritten',
        },
        status: 200,
      })),
    };
    const signal = new AbortController().signal;
    const api = createDocumentSourceAdapter(client);

    await expect(
      api.overwrite(
        { folderPath: '/project/notes', path: 'plan.md' },
        { content: '# Editor draft\n' },
        signal,
      ),
    ).resolves.toEqual({
      content: '# Editor draft\r\n',
      format: 'md',
      version: 'sha256:overwritten',
    });
    expect(client.request).toHaveBeenCalledWith({
      body: { content: '# Editor draft\n', overwrite: true },
      method: 'PUT',
      path: '/api/files/plan.md?folder=%2Fproject%2Fnotes',
      signal,
    });
  });

  it('classifies a stale save without exposing server detail', async () => {
    const api = createDocumentSourceAdapter({
      request: vi.fn(async () => ({
        body: {
          code: 'FILE_CHANGED',
          currentVersion: 'sha256:external',
          error: '/private/project/notes/plan.md changed',
        },
        status: 409,
      })),
    });

    await expect(
      api.save(
        { folderPath: '/project/notes', path: 'plan.md' },
        { baseVersion: 'sha256:before', content: 'draft' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      currentVersion: 'sha256:external',
      kind: 'conflict',
      message: 'The file changed on disk. Your unsaved changes are still available.',
    });
  });

  it('rejects a mismatched save response identity', async () => {
    const api = createDocumentSourceAdapter({
      request: vi.fn(async () => ({
        body: { content: 'saved', format: 'txt', name: 'other.txt', version: 'v2' },
        status: 200,
      })),
    });

    await expect(
      api.save(
        { folderPath: '/project/notes', path: 'plan.md' },
        { baseVersion: 'v1', content: 'saved' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});
