import { describe, expect, it, vi } from 'vite-plus/test';

import type { HttpClient } from '@/platform/http/client';

import { createIndexDecisionAdapter } from './index-decision-api';

const signal = new AbortController().signal;

describe('index decision API', () => {
  it('dismisses a warning and resyncs the folder', async () => {
    const request = vi.fn(async () => ({ body: { ok: true, added: [] }, status: 200 }));
    const api = createIndexDecisionAdapter({ request });
    await api.dismissWarning('/project/research', signal);
    await api.resync('/project/research', signal);
    expect(request).toHaveBeenNthCalledWith(1, {
      body: { folder: '/project/research' },
      method: 'POST',
      path: '/api/index-warning/dismiss',
      signal,
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      body: undefined,
      method: 'POST',
      path: '/api/sync?folder=%2Fproject%2Fresearch',
      signal,
    });
  });

  it('carries the server reason as the cause on failure', async () => {
    const client: HttpClient = {
      request: vi.fn(async () => ({ body: { error: 'daemon busy' }, status: 500 })),
    };
    await expect(
      createIndexDecisionAdapter(client).resync('/project/research', signal),
    ).rejects.toMatchObject({ cause: new Error('daemon busy'), kind: 'unavailable' });
  });
});
