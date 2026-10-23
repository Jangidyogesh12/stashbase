import { describe, expect, it, vi } from 'vite-plus/test';

import type { HttpClient } from '@/platform/http/client';
import { externalSource } from '@/shared/domain/external-source';

import { createDocumentAssetAdapter } from './asset-api';
import { createExternalFileAdapter } from './external-file-api';
import { createGenericFilePreviewAdapter } from './generic-preview-api';
import { createDocumentSourceAdapter } from './source-api';

const token = 'grant-token-abcdefghijklmn';
const signal = () => new AbortController().signal;

function client(body: unknown, headers: Record<string, string> = {}): HttpClient {
  return { request: vi.fn(async () => ({ body, headers, status: 200 })) };
}

describe('external file reads', () => {
  it('name only the grant, never the path, for every viewer', async () => {
    const pdf = externalSource(token, '/Users/reader/Desktop/report one.pdf');
    const assets = client(null, { 'x-stashbase-file-version': 'stat:1' });
    await expect(
      createDocumentAssetAdapter(assets, 'http://127.0.0.1:8090').load(pdf, signal()),
    ).resolves.toEqual({
      kind: 'source',
      url: `http://127.0.0.1:8090/asset/__external/${token}/report%20one.pdf?v=stat%3A1`,
      version: 'stat:1',
    });
    expect(assets.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'HEAD', path: `/api/external-files/${token}` }),
    );

    const notes = externalSource(token, '/Users/reader/Desktop/notes.md');
    const text = client({
      content: '# Notes',
      format: 'md',
      name: notes.path,
      version: 'sha256:1',
    });
    await expect(createDocumentSourceAdapter(text).load(notes, signal())).resolves.toEqual({
      content: '# Notes',
      format: 'md',
      version: 'sha256:1',
    });
    expect(text.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/api/external-files/${token}/text` }),
    );

    const save = client({
      content: '# Edited',
      format: 'md',
      name: notes.path,
      version: 'sha256:2',
    });
    await expect(
      createDocumentSourceAdapter(save).save(
        notes,
        { baseVersion: 'sha256:1', content: '# Edited' },
        signal(),
      ),
    ).resolves.toMatchObject({ content: '# Edited', version: 'sha256:2' });
    expect(save.request).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { baseVersion: 'sha256:1', content: '# Edited' },
        method: 'PUT',
        path: `/api/external-files/${token}/text`,
      }),
    );

    const csv = externalSource(token, '/Users/reader/Desktop/data.csv');
    const preview = client({ content: 'a,b', kind: 'text', name: csv.path, size: 3 });
    await expect(
      createGenericFilePreviewAdapter(preview).load(csv, signal()),
    ).resolves.toMatchObject({
      content: 'a,b',
      kind: 'text',
    });
    expect(preview.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/api/external-files/${token}/preview` }),
    );
  });
});

describe('external file drops', () => {
  it('turn a granted drop into an external source and keep refusals as refusals', async () => {
    const bridge = {
      open: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          result: {
            format: 'pdf',
            kind: 'external',
            name: 'report.pdf',
            path: '/Users/reader/report.pdf',
            token,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          result: { kind: 'refused', name: 'report.docx', reason: 'copy-required' },
        })
        .mockResolvedValueOnce({ ok: false, failure: { kind: 'unavailable', message: 'No.' } }),
    };
    const http = client({ ok: true });
    const api = createExternalFileAdapter(http, bridge);
    const file = new File(['x'], 'dropped.md');

    await expect(api.open(file)).resolves.toEqual({
      kind: 'external',
      source: externalSource(token, '/Users/reader/report.pdf'),
    });
    await expect(api.open(file)).resolves.toEqual({
      kind: 'refused',
      name: 'report.docx',
      reason: 'copy-required',
    });
    await expect(api.open(file)).resolves.toEqual({
      kind: 'refused',
      name: 'dropped.md',
      reason: 'unavailable',
    });

    await api.revoke(externalSource(token, '/Users/reader/report.pdf'));
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'DELETE', path: `/api/external-files/${token}` }),
    );
  });

  it('opens nothing without the desktop shell', async () => {
    const api = createExternalFileAdapter(client(null), undefined);
    expect(api.available).toBe(false);
    await expect(api.open(new File(['x'], 'notes.md'))).resolves.toEqual({
      kind: 'refused',
      name: 'notes.md',
      reason: 'unavailable',
    });
  });
});
