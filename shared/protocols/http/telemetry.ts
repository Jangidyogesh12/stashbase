import { z } from 'zod';

const runtime = z.enum(['stashbase', 'claude', 'codex']);
export const agentTurnStageSchema = z.enum(['preparing', 'host_accepted', 'runtime_dispatched', 'model_request_started', 'response_started', 'waiting_permission', 'tool_running']);
export const agentTurnReasonSchema = z.enum(['completed', 'runtime_error', 'user_cancelled', 'context_invalid', 'connection_lost', 'session_closed', 'scope_removed', 'app_shutdown', 'host_shutdown', 'app_update', 'host_restarted']);
export type AgentTurnStage = z.infer<typeof agentTurnStageSchema>;
const outcome = z.enum(['success', 'failed', 'cancelled', 'blocked']);
export { errorDiagnostic } from '../diagnostics';
export type { ErrorDiagnostic } from '../diagnostics';
import { diagnosticText, diagnosticSchema as diagnostic } from '../diagnostics';
/** Occurrences since this installation last reported the same diagnostic,
 * including this one. Absent from envelopes queued by older builds. */
const occurrences = z.number().int().min(1).max(1_000_000).optional();
export const diagnosticContextSchema = z.object({
  method: z.string().max(16).optional(), route: z.string().max(500).optional(),
  action: z.string().max(200).optional(), stage: z.string().max(100).optional(),
  model: z.string().max(200).optional(), runtime_version: z.string().max(100).optional(),
  turn_id: z.string().uuid().optional(),
  call_id: z.string().uuid().optional(), call_attempt: z.number().int().positive().optional(),
  tool_call_id: z.string().max(512).optional(), tool_category: z.enum(['read', 'write', 'shell', 'search', 'agent', 'other']).optional(),
  close_code: z.number().int().min(0).max(65535).optional(), was_clean: z.boolean().optional(),
  close_initiator: z.enum(['client', 'server', 'unknown']).optional(),
  connection_id: z.string().uuid().optional(), native_session_id: z.string().max(512).optional(),
  attempt_id: z.string().uuid().optional(), retry_of: z.string().uuid().optional(),
  target_version: z.string().max(100).optional(), process: z.string().max(100).optional(),
  reason: z.string().max(500).optional(), elapsed_ms: z.number().nonnegative().optional(),
  occurred_at: z.string().datetime().optional(), app_version: z.string().max(100).optional(),
}).strict();
export type DiagnosticContext = z.infer<typeof diagnosticContextSchema>;
/** Bound known diagnostic strings before validation; unknown fields still fail. */
export function boundedDiagnosticContext(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const limits: Record<string, number> = { method: 16, route: 500, action: 200, stage: 100,
    model: 200, runtime_version: 100, tool_call_id: 512, native_session_id: 512, target_version: 100, process: 100, reason: 500, app_version: 100 };
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key,
    typeof value === 'string' && limits[key] ? diagnosticText(value, limits[key]) : value]));
}

const correlation = { request_id: z.string().uuid().optional(), context: diagnosticContextSchema.optional() };
const diagnosticFields = {
  source: z.enum(['server', 'renderer', 'agent', 'native']), operation: z.string().max(200),
  runtime: runtime.optional(), diagnostic, occurrences,
  turn_id: z.string().uuid().optional(), request_id: z.string().uuid().optional(),
  context: diagnosticContextSchema.optional(),
};
export interface ErrorContext {
  source: 'server' | 'renderer' | 'agent' | 'native';
  turn_id?: string | undefined;
  request_id?: string | undefined;
  context?: DiagnosticContext | undefined;
  operation: string;
  runtime?: z.infer<typeof runtime>;
}

/** Strict field allowlist. The Node collection owner additionally redacts every
 * diagnostic; schema validation alone is not a privacy boundary. */
export const telemetryEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('app_opened') }).strict(),
  z.object({ event: z.literal('app_active'), mode: z.enum(['welcome', 'documents', 'chat']) }).strict(),
  z.object({ event: z.literal('document_engaged'), activity: z.enum(['read', 'edit']),
    format: z.enum(['md', 'txt', 'json', 'html', 'pdf', 'docx', 'image', 'audio', 'generic']) }).strict(),
  z.object({ event: z.literal('account_login_started') }).strict(),
  z.object({ event: z.literal('account_login_result'), ...correlation, outcome }).strict(),
  z.object({ event: z.literal('account_signed_out') }).strict(),
  z.object({ event: z.literal('billing_checkout_result'), ...correlation, outcome: z.enum(['success', 'failed']) }).strict(),
  z.object({ event: z.literal('billing_portal_result'), ...correlation, outcome: z.enum(['success', 'failed']) }).strict(),
  z.object({ event: z.literal('subscription_observed'), plan: z.enum(['free', 'plus', 'pro', 'other']),
    paid: z.boolean(), cancel_at_period_end: z.boolean() }).strict(),
  z.object({ event: z.literal('project_entry_result'), ...correlation, outcome }).strict(),
  z.object({ event: z.literal('agent_turn_started'), runtime, turn_id: z.string().uuid().optional() }).strict(),
  z.object({
    event: z.literal('agent_turn_finished'), runtime, outcome: z.enum(['success', 'failed', 'cancelled', 'blocked', 'interrupted']), turn_id: z.string().uuid().optional(),
    duration: z.enum(['under_10s', '10s_to_60s', '1m_to_5m', 'over_5m']).optional(),
    reason: agentTurnReasonSchema.optional(),
    source: z.enum(['renderer', 'host', 'recovery']).optional(),
    last_stage: agentTurnStageSchema.optional(), sequence: z.number().int().nonnegative().optional(),
    started_at: z.string().datetime().optional(), last_observed_at: z.string().datetime().optional(),
    finished_at: z.string().datetime().optional(), recovered_at: z.string().datetime().optional(),
    context: diagnosticContextSchema.optional(),
  }).strict(),
  z.object({ event: z.literal('agent_turn_stage'), runtime, turn_id: z.string().uuid(),
    stage: agentTurnStageSchema, sequence: z.number().int().nonnegative(),
    context: diagnosticContextSchema.optional(),
  }).strict(),
  z.object({ event: z.literal('document_write_result'), ...correlation, outcome: z.enum(['success', 'failed', 'conflict']), changed: z.boolean().optional() }).strict(),
  z.object({ event: z.literal('agent_setup_result'), runtime,
    stage: z.enum(['prepare', 'login', 'update', 'connect']), outcome,
    ...correlation,
    failure_stage: z.enum(['discovery', 'installation', 'authentication', 'mcp']).optional(),
    diagnostic: diagnostic.optional(),
  }).strict(),
  z.object({ event: z.literal('agent_setup_stage'), runtime, attempt_id: z.string().uuid(), stage: z.enum(['discovery', 'installation', 'authentication', 'mcp']), outcome: z.enum(['started', 'success']), ...correlation }).strict(),
  z.object({ event: z.literal('application_error'), ...diagnosticFields }).strict(),
  z.object({ event: z.literal('application_warning'), ...diagnosticFields }).strict(),
]);
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
/** Authentication, billing and persisted writes are host facts. Renderers
 * cannot manufacture identity links or account/conversion outcomes. */
export const rendererTelemetryEventSchema = telemetryEventSchema.refine((value) =>
  ['app_opened', 'app_active', 'document_engaged', 'agent_turn_started', 'agent_turn_finished'].includes(value.event));
export const telemetryPreferencesSchema = z.object({
  enabled: z.boolean(), available: z.boolean(),
}).strip();
export const telemetryPreferencesRequestSchema = z.object({
  enabled: z.boolean(),
}).strict();
export const telemetryFailureSchema = z.object({ error: z.string() }).passthrough();
