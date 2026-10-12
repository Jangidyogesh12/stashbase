import { z } from 'zod';

const fields = {
  message: z.string().max(8_000),
  name: z.string().max(120).optional(),
  code: z.string().max(160).optional(),
  stack: z.string().max(16_000).optional(),
  http_status: z.number().int().min(400).max(599).optional(),
  exit_code: z.number().int().optional(),
  request_id: z.string().max(200).optional(),
  signal: z.string().max(80).optional(),
  stdout: z.string().max(8_000).optional(),
  stderr: z.string().max(8_000).optional(),
  response_body: z.string().max(8_000).optional(),
  component_stack: z.string().max(8_000).optional(),
};
export const diagnosticSchema = z.object({
  ...fields,
  causes: z.array(z.object(fields).strict()).max(4).optional(),
  truncated: z.boolean().optional(),
}).strict();
export type ErrorDiagnostic = z.infer<typeof diagnosticSchema>;

/** Diagnostic prose is useful evidence. Filter credentials, not the explanation,
 * module names, or paths. Never enumerate arbitrary provider/request objects. */
export function diagnosticText(value: string, limit = 8_000): string {
  const cleaned = value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[credential]')
    .replace(/((?:set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, '$1[credential]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_.~=-]+/gi, '$1 [credential]')
    .replace(/((?:["']?)(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|password|passwd|secret|authorization|cookie|set-cookie)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;]+)/gi, '$1[credential]')
    .replace(/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[credential]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[credential]@')
    .replace(/data:[^\s,]*;base64,[A-Za-z0-9+/=]+/gi, '[data omitted]');
  if (cleaned.length <= limit) return cleaned;
  const marker = limit > 24 ? '\n… [truncated] …\n' : '…';
  const remaining = Math.max(0, limit - marker.length);
  const head = Math.ceil(remaining / 2);
  const tail = remaining - head;
  return `${cleaned.slice(0, head)}${marker}${tail ? cleaned.slice(-tail) : ''}`;
}

export function errorDiagnostic(error: unknown): ErrorDiagnostic {
  try {
    const seen = new Set<unknown>();
    let truncated = false;
    const text = (value: unknown, limit: number): string | undefined => {
      if (typeof value !== 'string' && typeof value !== 'number') return undefined;
      const raw = String(value);
      if (raw.length > limit) truncated = true;
      return diagnosticText(raw, limit);
    };
    const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
    const read = (value: unknown): Omit<ErrorDiagnostic, 'causes' | 'truncated'> => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const message = text(record.message ?? (typeof value === 'string' ? value : undefined), 8_000) ?? 'Unknown error';
      const result: Omit<ErrorDiagnostic, 'causes' | 'truncated'> = { message };
      for (const [key, limit, raw] of [
        ['name', 120, record.name], ['code', 160, record.code], ['stack', 16_000, record.stack],
        ['request_id', 200, record.request_id ?? record.requestId], ['signal', 80, record.signal],
        ['stdout', 8_000, record.stdout], ['stderr', 8_000, record.stderr], ['response_body', 8_000, record.response_body],
        ['component_stack', 8_000, record.component_stack ?? record.componentStack],
      ] as const) {
        const captured = text(raw, limit);
        if (captured !== undefined) result[key] = captured;
      }
      const status = integer(record.http_status ?? record.status ?? record.statusCode);
      if (status !== undefined && status >= 400 && status <= 599) result.http_status = status;
      const exit = integer(record.exit_code ?? record.exitCode);
      if (exit !== undefined) result.exit_code = exit;
      return result;
    };
    const diagnostic = read(error);
    const causes: NonNullable<ErrorDiagnostic['causes']> = [];
    const visit = (value: unknown, depth: number) => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      const record = value as Record<string, unknown>;
      const children = [record.cause, ...(Array.isArray(record.errors) ? record.errors : []), ...(Array.isArray(record.causes) ? record.causes : [])].filter(Boolean);
      for (const child of children) {
        if (seen.has(child)) continue;
        if (depth >= 4 || causes.length >= 4) { truncated = true; break; }
        causes.push(read(child));
        visit(child, depth + 1);
      }
    };
    visit(error, 0);
    const result: ErrorDiagnostic = { ...diagnostic, ...(causes.length ? { causes } : {}), ...(truncated || (error && typeof error === 'object' && 'truncated' in error && error.truncated === true) ? { truncated: true } : {}) };
    // A byte ceiling matters for CJK and escaped control characters as well
    // as ASCII; native spool and HTTP delivery share the same envelope budget.
    while (new TextEncoder().encode(JSON.stringify(result)).length > 128_000) {
      for (const item of [result, ...causes]) {
        for (const key of ['message', 'stack', 'stdout', 'stderr', 'response_body', 'component_stack'] as const) {
          const value = item[key];
          if (value && value.length > 256) item[key] = diagnosticText(value, Math.floor(value.length / 2));
        }
      }
      result.truncated = true;
    }
    return result;
  } catch { return { message: 'Could not serialize error diagnostics' }; }
}
