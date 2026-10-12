import { describe, expect, it, vi } from 'vite-plus/test';

import type { HttpClient, HttpRequest } from '@/platform/http/client';

import { createEmbedderAdapter } from './embedder-api';

const signal = new AbortController().signal;
const state = {
  authorized: false,
  hasKey: false,
  model: 'text-embedding-3-small',
  provider: 'openai',
  source: 'openai',
};

describe('embedder API', () => {
  it('loads the embedder state and saves a key with its provider', async () => {
    const request = vi.fn(async (input: HttpRequest) =>
      input.path === '/api/embedder'
        ? { body: state, status: 200 }
        : {
            body: {
              authorized: true,
              hasKey: true,
              model: 'm',
              provider: 'openai',
              source: 'openai',
              warning: 'offline',
            },
            status: 200,
          },
    );
    const api = createEmbedderAdapter({ request });
    expect((await api.load(signal)).hasKey).toBe(false);
    const saved = await api.saveKey('openai', 'sk-test', signal);
    expect(saved.warning).toBe('offline');
    expect(request).toHaveBeenLastCalledWith({
      body: { key: 'sk-test', provider: 'openai' },
      method: 'PUT',
      path: '/api/embedder/key',
      signal,
    });
  });

  it('uses provider and key presence even when legacy aliases disagree', async () => {
    const api = createEmbedderAdapter({
      request: vi.fn(async () => ({
        body: { ...state, hasKey: true, authorized: false, source: 'openrouter' },
        status: 200,
      })),
    });
    expect(await api.load(signal)).toEqual({
      hasKey: true,
      model: state.model,
      provider: 'openai',
    });
  });

  it('carries a provider rejection with the server message as its cause', async () => {
    const client: HttpClient = {
      request: vi.fn(async () => ({ body: { error: 'Invalid API key.' }, status: 401 })),
    };
    await expect(
      createEmbedderAdapter(client).saveKey('openai', 'bad', signal),
    ).rejects.toMatchObject({
      cause: new Error('Invalid API key.'),
      kind: 'rejected',
    });
  });
});
