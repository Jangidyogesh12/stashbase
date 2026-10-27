import type { ErrorReporter } from '@/shared/runtime/error-reporting';
export interface HttpRequest {
  body?: unknown;
  telemetryTurnId?: string;
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  body: unknown;
  bodyError?: unknown;
  headers?: Readonly<Record<string, string>>;
  status: number;
}

export interface HttpClient {
  request(request: HttpRequest): Promise<HttpResponse>;
  reportError?: ErrorReporter | undefined;
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createHttpClient(
  serverOrigin: string,
  fetchRequest: Fetch = fetch,
  reportError?: ErrorReporter,
): HttpClient {
  const baseUrl = new URL(serverOrigin);
  return {
    ...(reportError ? { reportError } : {}),
    async request({ body, method = 'GET', path, signal, telemetryTurnId }) {
      const headers = new Headers({ accept: 'application/json' });
      if (telemetryTurnId) headers.set('x-stashbase-agent-turn-id', telemetryTurnId);
      const correlation = telemetryTurnId ? { turn_id: telemetryTurnId } : {};
      // Local API data belongs to the live window/account. Chromium's HTTP
      // cache must not become a second owner beside the feature query caches.
      const init: RequestInit = {
        headers,
        method,
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      };
      if (body !== undefined) {
        headers.set('content-type', 'application/json');
        init.body = JSON.stringify(body);
      }
      let response: Response;
      try {
        response = await fetchRequest(new URL(path, baseUrl), init);
        // Older installations have exposed a bare 304 to fetch callers. There
        // is no cached body here: retry a read once without cache validation.
        // Never replay a mutation or a cancelled request.
        if (method === 'GET' && response.status === 304) {
          signal?.throwIfAborted();
          response = await fetchRequest(new URL(path, baseUrl), { ...init, cache: 'reload' });
        }
      } catch (error) {
        if (!signal?.aborted || signal.reason?.name === 'TimeoutError')
          reportError?.(error, 'http-transport', {
            ...correlation,
            method,
            route: path.split('?')[0] ?? path,
          });
        throw error;
      }
      let responseBody: unknown = null;
      let bodyError: unknown;
      if (method !== 'HEAD' && response.status !== 204 && response.status !== 205) {
        try {
          responseBody = await response.json();
        } catch (error) {
          if (signal?.aborted && signal.reason?.name !== 'TimeoutError') throw signal.reason;
          bodyError = error;
          reportError?.(
            Object.assign(new Error('Could not read the HTTP response as JSON', { cause: error }), {
              code: 'HTTP_RESPONSE_BODY_FAILED',
              status: response.status,
              request_id: response.headers.get('x-request-id') ?? undefined,
              content_type: response.headers.get('content-type') ?? undefined,
            }),
            'http-response',
            { ...correlation, method, route: path.split('?')[0] ?? path },
          );
          if (signal?.aborted) throw signal.reason;
        }
      }
      return {
        body: responseBody,
        ...(bodyError === undefined ? {} : { bodyError }),
        headers: Object.fromEntries(response.headers.entries()),
        status: response.status,
      };
    },
  };
}
