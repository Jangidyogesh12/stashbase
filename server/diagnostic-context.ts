import { AsyncLocalStorage } from 'node:async_hooks';
import type { DiagnosticContext } from '../shared/protocols/http/telemetry.ts';

export interface DiagnosticScope {
  request_id?: string;
  turn_id?: string;
  context?: DiagnosticContext;
}
export const diagnosticScope = new AsyncLocalStorage<DiagnosticScope>();
