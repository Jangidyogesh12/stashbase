import { passageContextItem, type AgentContextItem } from '@/features/agent/domain/context';
import type { AgentScope } from '@/features/agent/domain/session';
import type { AgentTranscriptBlock } from '@/features/agent/domain/session-transcript';
import type { AgentSessionBlockWire } from '@/protocols/http/agent-sessions';

/** One replayed block in the feature's terms. Image previews are server
 *  routes, absolutized here where the origin is known. A turn that carried a
 *  selected passage replays as bound context, so its passage reads as the
 *  chip it was sent as; a quote outside the chat's folder stays an upload. */
export function replayedBlock(
  block: AgentSessionBlockWire,
  scope: AgentScope,
  serverOrigin: string,
): AgentTranscriptBlock {
  if (block.kind !== 'user' || !block.attachments) return block;
  const attachments = block.attachments.map(({ quote, ...attachment }) => ({
    attachment: attachment.previewUrl
      ? { ...attachment, previewUrl: new URL(attachment.previewUrl, serverOrigin).href }
      : attachment,
    quote,
  }));
  if (!attachments.some(({ quote }) => quote !== undefined))
    return { ...block, attachments: attachments.map(({ attachment }) => attachment) };
  const folder = `${scope.path}/`;
  const context = attachments.map(({ attachment, quote }): AgentContextItem => {
    const passage =
      quote !== undefined && attachment.path.startsWith(folder)
        ? passageContextItem(
            { folderPath: scope.path, path: attachment.path.slice(folder.length) },
            quote,
          )
        : null;
    return (
      passage ?? {
        dims: attachment.dims,
        kind: 'transient',
        name: attachment.name,
        path: attachment.path,
        previewUrl: attachment.previewUrl,
      }
    );
  });
  const { attachments: _replayed, ...rest } = block;
  return { ...rest, context };
}
