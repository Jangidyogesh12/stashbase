import { describe, expect, it, vi } from 'vite-plus/test';

import { createUploadAdapter } from './upload-api';

const signal = new AbortController().signal;

describe('upload API', () => {
  it('posts multipart files with their folder and destination and maps published paths', async () => {
    const fetchRequest = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ files: [{ file: 'image.png' }] }), { status: 200 }),
    );
    const api = createUploadAdapter('http://127.0.0.1:43123', fetchRequest);
    const settled = await api.upload(
      '/project/research',
      [
        {
          blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
          name: 'image.png',
        },
      ],
      signal,
      'drafts',
    );
    expect(settled).toEqual({ paths: ['image.png'], refused: [] });
    const call = fetchRequest.mock.calls[0];
    if (!call) throw new Error('upload never reached fetch');
    const [url, init] = call;
    expect(String(url)).toBe('http://127.0.0.1:43123/api/upload');
    const form = init?.body as FormData;
    expect(form.get('folder')).toBe('/project/research');
    expect(form.get('dir')).toBe('drafts');
    expect(form.getAll('paths')).toEqual(['image.png']);
    expect((form.get('files') as File).name).toBe('image.png');
  });

  it('preserves partial success and identifies only refused request indices', async () => {
    const fetchRequest = vi.fn(async () =>
      Response.json({ files: [{ file: 'kept-2.md' }, { error: 'access denied', file: 'x.bin' }] }),
    );
    const files = ['kept.md', 'x.bin'].map((name) => ({ name, blob: new Blob(['fixture']) }));
    await expect(
      createUploadAdapter('http://127.0.0.1:43123', fetchRequest).upload(
        '/project',
        files,
        signal,
        '',
      ),
    ).resolves.toEqual({ paths: ['kept-2.md'], refused: [1] });
  });

  it('does not turn a lost response into a safe-to-retry failure', async () => {
    const fetchRequest = vi.fn(async () => {
      throw new Error('response lost');
    });
    await expect(
      createUploadAdapter('http://127.0.0.1:43123', fetchRequest).upload(
        '/project',
        [],
        signal,
        '',
      ),
    ).rejects.toMatchObject({ kind: 'outcome-unknown' });
  });

  it('classifies a missing folder as a lost scope', async () => {
    const fetchRequest = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'FOLDER_NOT_FOUND', error: 'folder not found' }), {
          status: 404,
        }),
    );
    await expect(
      createUploadAdapter('http://127.0.0.1:43123', fetchRequest).upload('/gone', [], signal, ''),
    ).rejects.toMatchObject({ kind: 'scope-lost', message: 'folder not found' });
  });
});
