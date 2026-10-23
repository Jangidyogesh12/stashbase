import { Pencil } from 'lucide-react';

import { ChatMessage, ChatMessageAction } from '@/components/ui/chat-message';
import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { segmentFileMentions, type AgentContextItem } from '@/features/agent/domain/context';
import type { AgentTranscriptBlock } from '@/features/agent/domain/session';
import { promptTimeLabel } from '@/features/agent/domain/time';
import { SentContextTiles } from '@/features/agent/ui/composer/context-tiles';
import { CollapsibleUserText } from '@/features/agent/ui/transcript/collapsible-user-text';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';
import { basePathName } from '@/shared/utils/file-path';

import { CopyAction } from './copy-action';

/** Context as it was sent, or the replayed attachments a native history
 *  record kept when this renderer never bound them. */
function sentContext(block: Extract<AgentTranscriptBlock, { kind: 'user' }>): AgentContextItem[] {
  if (block.context) return block.context;
  return (block.attachments ?? []).map((attachment) => ({
    dims: attachment.dims,
    kind: 'transient',
    name: attachment.name,
    path: attachment.path,
    previewUrl: attachment.previewUrl,
  }));
}

/** What the reader sent: its context tiles, then the text with each mention
 *  as the token it wore in the draft. */
export function UserMessage({
  block,
  editable,
  now,
  onEditPrompt,
  transientFile,
}: {
  block: Extract<AgentTranscriptBlock, { kind: 'user' }>;
  /** This prompt is the latest and its turn has settled, so it can be taken
   *  back into the composer. */
  editable: boolean;
  now: number;
  onEditPrompt?: ((blockId: string) => void) | undefined;
  transientFile?: ((path: string) => File | undefined) | undefined;
}) {
  const shape = useShape();
  const context = sentContext(block);
  const transientPaths = context.flatMap((item) => (item.kind === 'transient' ? [item.path] : []));
  const segments = segmentFileMentions(block.text, transientPaths);
  const mentioned = new Set(
    segments.flatMap((segment) => (segment.kind === 'mention' ? [segment.path] : [])),
  );
  // A source the text already mentions inline is not repeated as a tile;
  // only sources bound without a mention, such as a dropped row, get one.
  const tiles = context.filter(
    (item) => item.kind !== 'source' || !mentioned.has(item.source.path),
  );
  return (
    <div className="flex max-w-[72%] flex-col items-end gap-1.5 self-end not-first:mt-4">
      <SentContextTiles fileFor={transientFile} items={tiles} />
      <ChatMessage
        actions={
          <>
            <CopyAction label="Copy message" text={block.text} />
            {editable && onEditPrompt && (
              <ChatMessageAction
                icon={Pencil}
                label="Reuse message"
                onClick={() => onEditPrompt(block.id)}
              />
            )}
          </>
        }
        className="max-w-full"
        from="user"
        time={block.at === undefined ? undefined : promptTimeLabel(block.at, now)}
      >
        <CollapsibleUserText>
          <span className="sr-only">You: </span>
          {segments.map((segment) =>
            segment.kind === 'text' ? (
              segment.text
            ) : (
              // The same token the mention wore in the draft: paper, with an
              // inset hairline that adds nothing to the line's height, and the
              // muted file glyph the @ list drew.
              <span
                className={cn(
                  'mx-px inline-flex max-w-full items-center gap-1 px-1.5 py-px align-baseline font-medium ring-1 ring-border/50 ring-inset',
                  shape.chip,
                )}
                key={`${segment.start}:${segment.path}`}
                title={segment.path}
              >
                <FileTypeIcon
                  aria-hidden="true"
                  className="shrink-0 text-muted-foreground"
                  path={segment.path}
                  size={12}
                />
                <span className="truncate">{basePathName(segment.path)}</span>
                <span className="sr-only"> (file mention: {segment.path})</span>
              </span>
            ),
          )}
        </CollapsibleUserText>
      </ChatMessage>
    </div>
  );
}
