import { telemetry } from './telemetry.ts';
import { diagnosticText, errorDiagnostic, type ErrorDiagnostic } from '../shared/protocols/diagnostics.ts';
import { logger } from './log.ts';

const log = logger('agent-performance');

/** Observe protocol metadata, never retain model text, tools, or request bodies.
 * A single bounded frame is transient parser state, discarded at each boundary. */
export class HostedAgentRequestDiagnostic {
  private readonly decoder = new TextDecoder();
  private pending = '';
  private skippingFrame = false;
  private bytes = 0;
  private frames = 0;
  private malformedFrames = 0;
  private oversizedFrames = 0;
  private done = false;
  private ended = false;
  private readonly finishes = new Set<string>();
  private failure: ErrorDiagnostic | undefined;
  private status: number | undefined;
  private contentType: string | undefined;
  private requestId: string | undefined;
  private readonly started = performance.now();
  private headersMs: number | undefined;
  private firstByteMs: number | undefined;
  private firstTextMs: number | undefined;
  private finishedMs: number | undefined;
  private usage: Record<string, number> = {};
  private readonly capture = telemetry.scoped();
  private reportedFailure = false;

  constructor(private readonly callId: string, private readonly attempt: number,
    private readonly context?: { profile: string; turnId: string }) {
    if (context) telemetry.observeTurn(context.turnId, { stage: 'model_request_started',
      context: { call_id: callId, call_attempt: attempt } });
  }

  response(response: Response): Response {
    this.headersMs = this.elapsed();
    if (this.context) telemetry.observeTurn(this.context.turnId, { stage: 'response_started',
      context: { call_id: this.callId, call_attempt: this.attempt } });
    this.status = response.status;
    this.contentType = response.headers.get('content-type') ?? undefined;
    this.requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id')
      ?? response.headers.get('x-amzn-requestid') ?? undefined;
    if (!response.ok) this.reportFailure();
    if (!response.body) { this.ended = true; this.finish(); return response; }
    const sse = this.contentType?.includes('text/event-stream');
    const reader = response.body.getReader();
    let released = false;
    let cancelled = false;
    const release = () => { if (!released) { released = true; reader.releaseLock(); } };
    return new Response(new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const chunk = await reader.read();
          if (cancelled) return;
          if (chunk.done) {
            this.ended = true;
            if (sse) this.observe(this.decoder.decode() + '\n\n');
            this.finish();
            release();
            controller.close();
            return;
          }
          this.bytes += chunk.value.byteLength;
          this.firstByteMs ??= this.elapsed();
          if (sse) this.observe(this.decoder.decode(chunk.value, { stream: true }));
          controller.enqueue(chunk.value);
        } catch (error) {
          if (cancelled) return;
          this.fail(error);
          release();
          controller.error(error);
        }
      },
      cancel: async (reason) => {
        cancelled = true;
        try { await reader.cancel(reason); } finally { this.finish(); release(); }
      },
    }), { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  fail(error: unknown): void {
    this.failure = errorDiagnostic(error);
    this.finish();
    this.reportFailure();
  }

  private reportFailure(): void {
    if (!this.context || this.reportedFailure) return;
    // A header-only refusal may later gain an explicit provider explanation.
    this.reportedFailure = this.failure !== undefined;
    this.capture({ event: 'application_error', source: 'agent', runtime: 'stashbase', operation: 'model-request',
      turn_id: this.context.turnId, diagnostic: this.snapshot(),
      context: { call_id: this.callId, call_attempt: this.attempt, stage: 'model_request_started' } });
  }

  private elapsed(): number { return Math.round(performance.now() - this.started); }

  private timing() {
    return {
      headers_ms: this.headersMs, first_byte_ms: this.firstByteMs,
      first_text_ms: this.firstTextMs, elapsed_ms: this.finishedMs ?? this.elapsed(),
      ...this.usage,
    };
  }

  private finish(): void {
    if (this.finishedMs !== undefined) return;
    this.finishedMs = this.elapsed();
    log.debug('model request', { call_id: this.callId, attempt: this.attempt,
      profile: this.context?.profile, turn_id: this.context?.turnId, ...this.timing() });
  }

  snapshot(): ErrorDiagnostic {
    return errorDiagnostic({
      name: 'HostedAgentRequest', code: 'HOSTED_AGENT_RESPONSE',
      message: `Model gateway response: ${JSON.stringify({
        call_id: this.callId, attempt: this.attempt, bytes: this.bytes, frames: this.frames,
        stream_ended: this.ended, done: this.done, finish_reasons: [...this.finishes],
        malformed_frames: this.malformedFrames, oversized_frames: this.oversizedFrames,
        ...this.timing(),
      })}`,
      status: this.status, content_type: this.contentType, request_id: this.requestId ?? this.callId,
      cause: this.failure,
    });
  }

  private observe(text: string): void {
    // Consume slices so a single large chunk cannot defeat the frame limit.
    for (let offset = 0; offset < text.length; offset += 4096) {
      this.pending += text.slice(offset, offset + 4096);
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(this.pending))) {
        const frame = this.pending.slice(0, boundary.index);
        this.pending = this.pending.slice(boundary.index + boundary[0].length);
        if (!this.skippingFrame && frame.length <= 65_536) this.frame(frame);
        else if (!this.skippingFrame) this.oversizedFrames++;
        this.skippingFrame = false;
      }
      if (this.pending.length > 65_536) {
        if (!this.skippingFrame) this.oversizedFrames++;
        this.skippingFrame = true;
        this.pending = this.pending.slice(-3); // retain a split CRLF boundary
      }
    }
  }

  private frame(frame: string): void {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data) return;
    this.frames++;
    if (data === '[DONE]') { this.done = true; return; }
    try {
      const value = JSON.parse(data);
      if (!value || typeof value !== 'object') { this.malformedFrames++; return; }
      for (const [name, count] of Object.entries({
        input_tokens: value.usage?.prompt_tokens,
        output_tokens: value.usage?.completion_tokens,
        cached_tokens: value.usage?.prompt_tokens_details?.cached_tokens,
        cache_write_tokens: value.usage?.prompt_tokens_details?.cache_write_tokens,
      })) {
        if (typeof count === 'number' && Number.isFinite(count) && count >= 0) this.usage[name] = count;
      }
      const streamError = value.error ?? (Array.isArray(value.choices)
        ? value.choices.find((choice: { error?: unknown } | null) => choice?.error)?.error : undefined);
      if (streamError) {
        const error = streamError;
        this.fail({ name: 'ModelStreamError',
          message: typeof error === 'string' ? error : error.message ?? 'Model stream returned an error',
          code: error.code ?? error.type, status: error.status ?? error.status_code,
        });
      }
      if (Array.isArray(value.choices)) {
        for (const choice of value.choices) {
          if (typeof choice?.delta?.content === 'string' && choice.delta.content.length > 0)
            this.firstTextMs ??= this.elapsed();
          if (typeof choice?.finish_reason === 'string' && this.finishes.size < 8)
            this.finishes.add(diagnosticText(choice.finish_reason, 120));
        }
      }
    } catch { this.malformedFrames++; }
  }
}
