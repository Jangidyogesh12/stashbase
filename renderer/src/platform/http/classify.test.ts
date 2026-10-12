import { describe, expect, it, vi } from 'vite-plus/test';

import { featureErrorClass } from '@/shared/domain/feature-error';

import {
  classifyResponse,
  request,
  send,
  transportError,
  type ResponseSchema,
  type TransportFailure,
} from './classify';
import type { HttpClient, HttpResponse } from './client';

const NoteError = featureErrorClass<'conflict' | 'invalid-request'>('NoteError');

function text(input: unknown, key: string): string | null {
  if (input === null || typeof input !== 'object') return null;
  const record: Record<string, unknown> = { ...input };
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

const noteSchema: ResponseSchema<{ note: string }> = {
  safeParse(input) {
    const note = text(input, 'note');
    return note === null ? { success: false } : { success: true, data: { note } };
  },
};

const failureSchema: ResponseSchema<{ error: string }> = {
  safeParse(input) {
    const error = text(input, 'error');
    return error === null ? { success: false } : { success: true, data: { error } };
  },
};

function client(...responses: HttpResponse[]): HttpClient {
  const queue = [...responses];
  return {
    request: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('The test client ran out of responses.');
      return next;
    }),
  };
}

function noteRequest(signal?: AbortSignal) {
  return {
    error: NoteError,
    failureSchema,
    path: '/api/notes',
    schema: noteSchema,
    ...(signal === undefined ? {} : { signal }),
  };
}

describe('response classification', () => {
  it('reads a withdrawn grant, a lost folder, and an unreachable capability', () => {
    expect(classifyResponse({ body: null, status: 401 })).toBe('unauthorized');
    expect(classifyResponse({ body: null, status: 403 })).toBe('unauthorized');
    expect(classifyResponse({ body: null, status: 404 })).toBe('scope-lost');
    expect(classifyResponse({ body: null, status: 410 })).toBe('scope-lost');
    expect(classifyResponse({ body: null, status: 412 })).toBe('scope-lost');
    expect(classifyResponse({ body: null, status: 400 })).toBe('unavailable');
    expect(classifyResponse({ body: null, status: 500 })).toBe('unavailable');
  });

  it('gives each kind one diagnostic sentence', () => {
    const error = transportError({ body: null, status: 500 }, { error: NoteError });

    expect(error.kind).toBe('unavailable');
    expect(error.message).toBe('StashBase is unavailable.');
    expect(error.name).toBe('NoteError');
  });
});

describe('the shared HTTP envelope', () => {
  it('sends only the fields the call names and returns the validated body', async () => {
    const transport = client({ body: { note: 'kept' }, status: 200 });
    const signal = new AbortController().signal;

    await expect(request(transport, noteRequest(signal))).resolves.toEqual({ note: 'kept' });
    expect(transport.request).toHaveBeenCalledWith({ path: '/api/notes', signal });
  });

  it('forwards a body and method when the call carries one', async () => {
    const transport = client({ body: { note: 'kept' }, status: 200 });

    await request(transport, { ...noteRequest(), body: { note: 'draft' }, method: 'PUT' });

    expect(transport.request).toHaveBeenCalledWith({
      body: { note: 'draft' },
      method: 'PUT',
      path: '/api/notes',
    });
  });

  it('reports a body the schema rejects on the owning ladder', async () => {
    await expect(
      request(client({ body: { wrong: true }, status: 200 }), noteRequest()),
    ).rejects.toMatchObject({ kind: 'invalid-response', name: 'NoteError' });
  });

  it('maps each refused status onto the shared ladder', async () => {
    await expect(request(client({ body: null, status: 403 }), noteRequest())).rejects.toMatchObject(
      { kind: 'unauthorized' },
    );
    await expect(request(client({ body: null, status: 410 }), noteRequest())).rejects.toMatchObject(
      { kind: 'scope-lost' },
    );
    await expect(request(client({ body: null, status: 500 }), noteRequest())).rejects.toMatchObject(
      { kind: 'unavailable' },
    );
  });

  it('carries the server sentence as the cause', async () => {
    await expect(
      request(client({ body: { error: '/private/notes is gone' }, status: 410 }), noteRequest()),
    ).rejects.toMatchObject({ cause: new Error('/private/notes is gone') });
  });

  it('reads a 400 as the reader own request when the call names that kind', async () => {
    const rejected = { body: { error: 'Name is required.' }, status: 400 };
    await expect(
      request(client(rejected), { ...noteRequest(), invalidRequest: 'invalid-request' as const }),
    ).rejects.toMatchObject({ cause: new Error('Name is required.'), kind: 'invalid-request' });
    await expect(request(client(rejected), noteRequest())).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('gives the owning adapter first refusal, and classifies what it declines', async () => {
    const failure = ({ kind, response, serverMessage }: TransportFailure) =>
      response.status === 409
        ? new NoteError('conflict', `Already taken: ${serverMessage ?? kind}`)
        : null;

    await expect(
      request(client({ body: { error: 'note.md' }, status: 409 }), { ...noteRequest(), failure }),
    ).rejects.toMatchObject({ kind: 'conflict', message: 'Already taken: note.md' });
    await expect(
      request(client({ body: null, status: 404 }), { ...noteRequest(), failure }),
    ).rejects.toMatchObject({ kind: 'scope-lost' });
  });

  it('reports an unreachable server on the owning ladder, keeping the transport cause', async () => {
    const offline = new Error('offline');
    const transport: HttpClient = {
      request: vi.fn(async () => {
        throw offline;
      }),
    };

    const rejection = request(transport, noteRequest());
    await expect(rejection).rejects.toMatchObject({ kind: 'unavailable', name: 'NoteError' });
    await expect(rejection).rejects.toMatchObject({ cause: offline });
  });

  it('leaves a cancellation the caller asked for as the caller own rejection', async () => {
    const controller = new AbortController();
    const cancelled = new DOMException('aborted', 'AbortError');
    const transport: HttpClient = {
      request: vi.fn(async () => {
        controller.abort(cancelled);
        throw cancelled;
      }),
    };

    await expect(request(transport, noteRequest(controller.signal))).rejects.toBe(cancelled);
  });

  it('hands a checked response back whole when the success path needs its headers', async () => {
    const transport = client({
      body: null,
      headers: { 'x-stashbase-file-version': 'v3' },
      status: 204,
    });

    await expect(
      send(transport, { error: NoteError, method: 'HEAD', path: '/api/files/paper.pdf' }),
    ).resolves.toMatchObject({ headers: { 'x-stashbase-file-version': 'v3' }, status: 204 });
  });
});
