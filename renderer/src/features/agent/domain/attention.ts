export interface RequestTarget {
  sessionId: string;
  requestId: string;
}
export interface AttentionRequest extends RequestTarget {
  project: string;
  conversation: string;
}

/** Stable only for this live request. Notification transport treats it as opaque. */
export function attentionId(target: RequestTarget): string {
  return JSON.stringify([target.sessionId, target.requestId]);
}

export type AttentionTarget =
  | (RequestTarget & { blockId?: never })
  | { sessionId: string; blockId: string; requestId?: never };
