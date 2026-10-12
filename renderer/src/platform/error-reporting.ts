import type { HttpClient } from '@/platform/http/client';
import { errorDiagnostic } from '@/protocols/http/telemetry';
import type { ErrorReporter } from '@/shared/runtime/error-reporting';
export type { ErrorReporter } from '@/shared/runtime/error-reporting';

/** Diagnostics go only to the local host, which redacts, deduplicates and applies
 * the same privacy preference as usage statistics before any external delivery. */
export function createErrorReporter(client: HttpClient): ErrorReporter {
  const queue: Array<{ body: Record<string, unknown>; attempts: number }> = [];
  let draining = false;
  const drain = async () => {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const entry = queue[0];
      if (!entry) break;
      try {
        const response = await client.request({
          path: '/api/log/client-error',
          method: 'POST',
          body: entry.body,
          signal: AbortSignal.timeout(2000),
        });
        if (response.status >= 500 || response.status === 408 || response.status === 429)
          throw new Error('Diagnostic delivery temporarily unavailable');
        queue.shift();
      } catch {
        entry.attempts += 1;
        if (entry.attempts >= 3) queue.shift();
        else {
          draining = false;
          setTimeout(() => {
            void drain();
          }, entry.attempts * 1000);
          return;
        }
      }
    }
    draining = false;
  };
  return (error, operation, context) => {
    try {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (queue.length >= 100) return;
      queue.push({
        body: { ...errorDiagnostic(error), operation, ...(context ? { context } : {}) },
        attempts: 0,
      });
      void drain();
    } catch {
      /* Reporting never changes the user operation. */
    }
  };
}

export function listenForRendererErrors(
  report: ErrorReporter,
  target: Window = window,
): () => void {
  const onError = (event: ErrorEvent) => {
    if (
      event.target instanceof Element &&
      ['IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'SCRIPT', 'LINK'].includes(event.target.tagName)
    ) {
      report(
        new Error(`Resource loading or decoding failed: ${event.target.tagName}`),
        'resource',
        {
          action: event.target.tagName,
          route: event.target.getAttribute('src') ?? event.target.getAttribute('href') ?? '',
        },
      );
    } else report(event.error ?? event.message, 'uncaught');
  };
  const onRejection = (event: PromiseRejectionEvent) => report(event.reason, 'unhandled-rejection');
  target.addEventListener('error', onError, true);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError, true);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

/** Preserve the result/cancellation semantics of caught native operations. */
export async function reportFailure<T>(
  invoke: () => Promise<T>,
  report: ErrorReporter | undefined,
  operation: string,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await invoke();
  } catch (error) {
    if (!signal?.aborted) report?.(error, operation);
    throw error;
  }
}

/** React supplies component ownership separately from the thrown error. */
export function reportComponentError(
  report: ErrorReporter | undefined,
  error: unknown,
  componentStack?: string | null,
): void {
  report?.({ ...errorDiagnostic(error), component_stack: componentStack ?? '' }, 'render');
}
