import { Readable } from 'node:stream';

const MAX_PREFIX_BYTES = 64 * 1024;
export const INTERRUPTED_MODEL_RESPONSE = {
  // OpenCode retries unknown SSE errors whose serialized data contains
  // "unavailable"/"exhausted", calling them "Provider is overloaded". This
  // terminal envelope must not carry the gateway's retry-triggering code.
  code: 'agent_response_interrupted',
  message: 'The agent model response was interrupted. The task may be incomplete; completed file changes have been kept. Try again later.',
  type: 'stashbase_hosted_error',
};

type Frame = { text: string; empty: boolean; interrupted?: boolean; outputText?: string };

function inspectFrame(text: string, opaque = false): Frame {
  const data = text.split(/\r?\n/).filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart()).join('\n').trim();
  if (!data || data === '[DONE]') return { text, empty: true };
  if (opaque) return { text, empty: false };
  try {
    const payload = JSON.parse(data);
    const choices = Array.isArray(payload?.choices) ? payload.choices : [];
    const emptyDelta = (delta: Record<string, unknown>) => delta && typeof delta === 'object'
      && Object.entries(delta).every(([key, value]) => key === 'role'
        || (key === 'content' && (value == null || (typeof value === 'string' && !value.trim()))));
    if (payload?.error?.code === 'agent_provider_unavailable'
        || choices.some((choice: { error?: { code?: string } }) => choice?.error?.code === 'agent_provider_unavailable')) {
      const empty = choices.every((choice: { delta?: Record<string, unknown> }) => !choice?.delta || emptyDelta(choice.delta));
      // An error can share a frame with output. Preserve that delta, but never
      // allow its error finish to masquerade as successful completion.
      const outputText = empty ? undefined : `data: ${JSON.stringify({
        ...payload, error: undefined,
        choices: choices.map((choice: Record<string, unknown>) => ({ ...choice, error: undefined, finish_reason: null })),
      })}\n\n`;
      return { text, interrupted: true, empty, outputText };
    }
    const empty = payload && !payload.error && Array.isArray(payload.choices)
      && choices.every((choice: { delta: Record<string, unknown>; finish_reason?: string | null }) => choice
        && [undefined, null, 'stop', 'unknown'].includes(choice.finish_reason) && emptyDelta(choice.delta));
    return { text, empty: Boolean(empty) };
  } catch { return { text, empty: false }; }
}

/** Bound inspection, not model output: oversized frames pass through opaquely.
 * Retain split CRLF delimiters and UTF-8 characters across transport chunks. */
async function* frames(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): AsyncGenerator<Frame> {
  const decoder = new TextDecoder();
  let pending = '';
  let opaque = false;
  while (true) {
    signal.throwIfAborted();
    const next = await reader.read();
    signal.throwIfAborted();
    const text = decoder.decode(next.value, { stream: !next.done });
    for (let offset = 0; offset < text.length; offset += 4096) {
      pending += text.slice(offset, offset + 4096);
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        const end = boundary.index + boundary[0].length;
        yield inspectFrame(pending.slice(0, end), opaque);
        pending = pending.slice(end);
        opaque = false;
      }
      if (pending.length > MAX_PREFIX_BYTES) {
        let cut = pending.length - 3;
        if (/[\uD800-\uDBFF]/.test(pending[cut - 1]!)) cut--;
        yield inspectFrame(pending.slice(0, cut), true);
        pending = pending.slice(cut);
        opaque = true;
      }
    }
    if (next.done) {
      if (pending) yield inspectFrame(pending, opaque);
      return;
    }
  }
}

/** Hold empty framing until output or a known hosted interruption. Only the
 * latter is normalized; unknown provider extensions retain their own meaning. */
export async function modelStream(upstream: Response, signal: AbortSignal): Promise<Readable | 'empty' | 'interrupted'> {
  if (!upstream.body) return 'empty';
  if (!upstream.headers.get('content-type')?.includes('text/event-stream')) return Readable.fromWeb(upstream.body);
  const reader = upstream.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => cleanupPromise ??= (async () => {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  })();
  const iterator = frames(reader, signal);
  let handedOff = false;
  const prefix: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) return 'empty';
      const frame = next.value;
      if (frame.interrupted && frame.empty) return 'interrupted';
      if (!frame.empty) {
        const stream = Readable.from((async function* () {
          try {
            yield* prefix;
            let current = frame;
            while (true) {
              signal.throwIfAborted();
              if (current.interrupted) {
                if (current.outputText) yield current.outputText;
                yield `data: ${JSON.stringify({ error: INTERRUPTED_MODEL_RESPONSE })}\n\n`;
                return;
              }
              yield current.text;
              const next = await iterator.next();
              if (next.done) return;
              current = next.value;
            }
          } finally { await cleanup(); }
        })());
        stream.once('close', () => { void cleanup(); });
        handedOff = true;
        return stream;
      }
      prefix.push(frame.text);
      bytes += Buffer.byteLength(frame.text);
      if (bytes > MAX_PREFIX_BYTES) throw Object.assign(new Error('The agent model returned too much data without a reply.'), { status: 422 });
    }
  } finally {
    if (!handedOff) await cleanup();
  }
}
