export type JsonObject = Record<string, unknown>;
export type JsonRpcId = string | number;
export type CodexTurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export function codexTurnStatus(value: unknown): CodexTurnStatus | '' {
  switch (value) {
    case 'completed':
    case 'interrupted':
    case 'failed':
    case 'inProgress':
      return value;
    default:
      return '';
  }
}

export interface ThreadItem {
  type?: unknown;
  id?: unknown;
  [key: string]: unknown;
}
export function toolStartFromItem(item: ThreadItem): { id: string; name: string; input: JsonObject } | null {
  const type = stringValue(item.type);
  const id = stringValue(item.id);
  if (!type || !id) return null;
  switch (type) {
    case 'commandExecution':
      return {
        id,
        name: 'Bash',
        input: {
          command: stringValue(item.command),
          cwd: stringValue(item.cwd),
          // Codex's app-server classifies shell work (read/list/search) as
          // well as carrying the literal command. Preserve that structured
          // data so the renderer can show an activity trace instead of only
          // a generic "Bash" status.
          actions: Array.isArray(item.commandActions) ? item.commandActions : [],
        },
      };
    case 'fileChange':
      return { id, name: 'File change', input: { changes: item.changes ?? [] } };
    case 'mcpToolCall':
      return {
        id,
        name: `${stringValue(item.server) || 'mcp'}:${stringValue(item.tool) || 'tool'}`,
        input: objectValue(item.arguments),
      };
    case 'dynamicToolCall':
      return {
        id,
        name: [stringValue(item.namespace), stringValue(item.tool)].filter(Boolean).join(':') || 'tool',
        input: objectValue(item.arguments),
      };
    case 'webSearch':
      return { id, name: 'Web search', input: { query: stringValue(item.query) } };
    default:
      return null;
  }
}

export function toolResultFromItem(item: ThreadItem): { id: string; content: string; isError: boolean } | null {
  const type = stringValue(item.type);
  const id = stringValue(item.id);
  if (!type || !id) return null;
  switch (type) {
    case 'commandExecution':
      return {
        id,
        content: stringValue(item.aggregatedOutput) || exitSummary(item.exitCode),
        isError: typeof item.exitCode === 'number' && item.exitCode !== 0,
      };
    case 'fileChange':
      return { id, content: stringifyCodexValue(item.changes ?? []), isError: stringValue(item.status) === 'failed' };
    case 'mcpToolCall': {
      const error = item.error;
      return {
        id,
        content: error ? stringifyCodexValue(error) : stringifyCodexValue(item.result),
        isError: !!error || stringValue(item.status) === 'failed',
      };
    }
    case 'dynamicToolCall':
      return {
        id,
        content: stringifyCodexValue(item.contentItems ?? []),
        isError: item.success === false || stringValue(item.status) === 'failed',
      };
    case 'webSearch':
      return { id, content: stringifyCodexValue(item.action ?? ''), isError: false };
    default:
      return null;
  }
}

export function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function exitSummary(value: unknown): string {
  return typeof value === 'number' ? `Command exited with code ${value}.` : '';
}

export function rpcError(value: unknown): Error {
  if (value && typeof value === 'object') {
    const obj = value as JsonObject;
    const message = stringValue(obj.message);
    if (message) return new Error(message);
  }
  return new Error('Codex app-server request failed.');
}

export function errorFromUnknown(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

export function stringifyCodexValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
