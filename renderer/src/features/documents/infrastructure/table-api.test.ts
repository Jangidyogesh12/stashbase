import { describe, expect, it, vi } from 'vite-plus/test';

import type { HttpClient } from '@/platform/http/client';
import { externalSource } from '@/shared/domain/external-source';

import { createDelimitedTableAdapter } from './table-api';

const page = (name: string) => ({
  columnCount: 2,
  delimiter: ';',
  editable: true,
  kind: 'table',
  name,
  rowCount: 1,
  rows: [['a', 'b']],
  size: 4,
  start: 0,
  totalColumns: 2,
  version: 'stat:1',
});

describe('delimited table API', () => {
  it('reads a project table page through its explicit member folder', async () => {
    const request = vi.fn<HttpClient['request']>(async () => ({
      body: page('data/sales #1.csv'),
      status: 200,
    }));
    const api = createDelimitedTableAdapter({ request });
    await expect(
      api.load(
        { folderPath: '/project/source code', path: 'data/sales #1.csv' },
        { count: 200, start: 0 },
        new AbortController().signal,
      ),
    ).resolves.toEqual(page('data/sales #1.csv'));
    expect(request.mock.calls[0]?.[0].path).toBe(
      '/api/file-table/data/sales%20%231.csv?count=200&start=0&folder=%2Fproject%2Fsource+code',
    );
  });

  it('reads a dropped file only through its grant', async () => {
    const request = vi.fn<HttpClient['request']>(async () => ({
      body: page('/Users/reader/sales.csv'),
      status: 200,
    }));
    const api = createDelimitedTableAdapter({ request });
    await api.load(
      externalSource('grant-token', '/Users/reader/sales.csv'),
      { count: 50, start: 200 },
      new AbortController().signal,
    );
    expect(request.mock.calls[0]?.[0].path).toBe(
      '/api/external-files/grant-token/table?count=50&start=200',
    );
  });

  it('reports a missing file and refuses a page for another file', async () => {
    const missing = createDelimitedTableAdapter({
      request: vi.fn(async () => ({ body: { error: 'not found' }, status: 404 })),
    });
    await expect(
      missing.load(
        { folderPath: '/project', path: 'gone.csv' },
        { count: 1, start: 0 },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: 'missing' });
    const other = createDelimitedTableAdapter({
      request: vi.fn(async () => ({ body: page('other.csv'), status: 200 })),
    });
    await expect(
      other.load(
        { folderPath: '/project', path: 'sales.csv' },
        { count: 1, start: 0 },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});
