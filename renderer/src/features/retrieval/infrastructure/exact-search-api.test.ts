import { describe, expect, it, vi } from 'vite-plus/test';

import type { HttpClient } from '@/platform/http/client';

import { createExactSearchAdapter } from './exact-search-api';

describe('exact search API', () => {
  it('posts a complete scope and maps stable folder-qualified evidence', async () => {
    const client: HttpClient = {
      request: vi.fn(async () => ({
        body: {
          files: [
            {
              folder: '/project/research',
              matches: [{ line: 4, ranges: [[0, 6]], text: 'answer text' }],
              path: 'notes/answer.md',
              totalMatches: 1,
            },
          ],
          totalMatches: 1,
          truncated: false,
        },
        status: 200,
      })),
    };
    const signal = new AbortController().signal;

    await expect(
      createExactSearchAdapter(client).search(
        {
          caseSensitive: false,
          folderPath: '/project/research',
          query: 'answer',
          wholeWord: false,
        },
        signal,
      ),
    ).resolves.toMatchObject({
      files: [
        {
          id: '/project/research\u0000notes/answer.md',
          source: { folderPath: '/project/research', path: 'notes/answer.md' },
        },
      ],
    });
    expect(client.request).toHaveBeenCalledWith({
      body: {
        case_strict: false,
        folder: '/project/research',
        query: 'answer',
        whole_word: false,
      },
      method: 'POST',
      path: '/api/project/keyword-search',
      signal,
    });
  });

  it('rejects malformed success and sanitizes server failures', async () => {
    const malformed = createExactSearchAdapter({
      request: vi.fn(async () => ({ body: { files: 'wrong' }, status: 200 })),
    });
    await expect(
      malformed.search(
        {
          caseSensitive: false,
          folderPath: '/project/research',
          query: 'answer',
          wholeWord: false,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: 'invalid-response' });

    const unavailable = createExactSearchAdapter({
      request: vi.fn(async () => ({
        body: { error: 'private filesystem detail' },
        status: 500,
      })),
    });
    await expect(
      unavailable.search(
        {
          caseSensitive: false,
          folderPath: '/project/research',
          query: 'answer',
          wholeWord: false,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
