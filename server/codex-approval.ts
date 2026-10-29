import { objectValue, stringValue, type JsonObject } from './codex-protocol.ts';

export interface CodexMcpToolApproval {
  toolUseId: string;
  name: string;
  title: string;
  input: JsonObject;
  approvalScopes: Array<'session' | 'always'>;
}
export function approvalTitle(reason: unknown, detail: unknown, fallback: string): string {
  const normalizedReason = stringValue(reason);
  if (normalizedReason) return normalizedReason;
  const normalizedDetail = stringValue(detail);
  return normalizedDetail ? `${fallback} ${normalizedDetail}` : fallback;
}

export function commandApprovalInput(params: JsonObject): JsonObject {
  return {
    command: stringValue(params.command),
    cwd: stringValue(params.cwd),
    reason: stringValue(params.reason),
    commandActions: params.commandActions ?? [],
  };
}

export function fileChangeApprovalInput(params: JsonObject): JsonObject {
  return {
    itemId: stringValue(params.itemId),
    reason: stringValue(params.reason),
    grantRoot: stringValue(params.grantRoot),
  };
}

export function mcpToolApprovalFromElicitation(
  params: JsonObject,
): CodexMcpToolApproval | null {
  const meta = objectValue(params._meta);
  const kind = stringValue(meta.codex_approval_kind) || stringValue(meta.approval_kind);
  const tool = stringValue(meta.tool_name)
    || stringValue(meta.toolName)
    || stringValue(meta.tool)
    || stringValue(params.tool_name)
    || stringValue(params.toolName)
    || stringValue(params.tool);
  if (kind !== 'mcp_tool_call' && !tool) return null;

  const server = stringValue(meta.connector_name)
    || stringValue(meta.server_name)
    || stringValue(meta.server)
    || stringValue(params.server_name)
    || stringValue(params.server);
  const toolTitle = stringValue(meta.tool_title) || stringValue(meta.title);
  const name = [server, toolTitle || tool].filter(Boolean).join(':') || 'MCP tool';
  const prompt = protocolNoticeFromParams(params);
  const toolUseId = stringValue(meta.codex_mcp_tool_call_id)
    || stringValue(meta.codex_call_id)
    || stringValue(meta.call_id)
    || stringValue(params.itemId)
    || stringValue(params.item_id)
    || stringValue(params.toolUseId)
    || stringValue(params.tool_use_id);
  const args = objectValue(meta.tool_params);

  return {
    toolUseId,
    name,
    title: prompt || `Allow Codex to use ${name}?`,
    approvalScopes: mcpApprovalScopes(params),
    input: {
      server,
      tool,
      arguments: args,
      prompt,
      requestedSchema: params.requestedSchema ?? params.requested_schema ?? null,
    },
  };
}

/** Codex advertises supported persistence modes in the request's `_meta.persist`.
 * The accepted scope goes back in response metadata, not in form content. */
export function mcpApprovalScopes(params: JsonObject): Array<'session' | 'always'> {
  const persist = objectValue(params._meta).persist;
  const offered = Array.isArray(persist) ? persist : [persist];
  return (['session', 'always'] as const).filter(scope => offered.includes(scope));
}

export function commandCanRemember(params: JsonObject): boolean {
  return !Array.isArray(params.availableDecisions) || params.availableDecisions.includes('acceptForSession');
}

export function codexTurnAccessOptions(mode: string | undefined, cwd: string, previousMode: string | undefined, workspacePolicy?: JsonObject): JsonObject {
  const { approvalPolicy, approvalsReviewer, sandbox } = codexAccessOptions(mode);
  return {
    approvalPolicy,
    approvalsReviewer,
    // Reviewer-only changes preserve the runtime's resolved sandbox and grants.
    ...(sandbox === codexAccessOptions(previousMode).sandbox ? {} : { sandboxPolicy: sandbox === 'read-only'
      ? { type: 'readOnly' }
      : workspacePolicy ?? { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false } }),
  };
}

export function requestedPermissions(params: JsonObject | undefined): JsonObject {
  const permissions = objectValue(params?.permissions);
  const granted: JsonObject = {};
  if (permissions.network) granted.network = permissions.network;
  if (permissions.fileSystem) granted.fileSystem = permissions.fileSystem;
  return granted;
}

export function codexAccessOptions(mode: string | undefined): {
  approvalPolicy: string;
  approvalsReviewer: string;
  sandbox: string;
} {
  switch (mode) {
    case 'acceptEdits':
      return { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' };
    case 'plan':
      return { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' };
    case 'auto':
      // `auto` is the panel's stable mode name. The Codex app-server wire
      // protocol calls the equivalent approval reviewer `auto_review`.
      return { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write' };
    case 'default':
    default:
      return { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' };
  }
}

/** A displayable notice from a native prompt or notification: its message,
 * error message, or summary/details, then any prompt text. */
export function protocolNoticeFromParams(params: JsonObject): string {
  return notificationMessage(params)
    || stringValue(params.prompt)
    || stringValue(params.message);
}

export function notificationMessage(params: JsonObject): string {
  const direct = usefulMessage(params.message);
  if (direct) return direct;
  const fromError = usefulMessage(objectValue(params.error).message);
  if (fromError) return fromError;
  const summary = usefulMessage(params.summary);
  const details = usefulMessage(params.details);
  if (summary && details && details !== summary) return `${summary}\n\n${details}`;
  return summary || details;
}

export function usefulMessage(value: unknown): string {
  const message = stringValue(value);
  return message.trim() ? message : '';
}
