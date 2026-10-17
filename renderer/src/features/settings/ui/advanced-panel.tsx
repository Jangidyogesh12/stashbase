import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { EmbedderPort } from '@/features/settings/application/embedder-port';
import type { McpAccessPort } from '@/features/settings/application/ports';
import { embedderSummary } from '@/features/settings/domain/embedder';
import { useEmbedderState } from '@/features/settings/hooks/use-embedder';

import { AiIndexPanel } from './ai-index/ai-index-panel';
import { McpAccessPanel } from './mcp/mcp-access-panel';
import { SettingsList, SettingsPane, SettingsRow } from './rows';

/** Whether search by meaning is on, read from the same query the search page
 *  uses, so this row and the page cannot disagree. */
function SearchSummary({ embedderApi }: { embedderApi: EmbedderPort }) {
  const { loading, state } = useEmbedderState(embedderApi);
  if (state) return embedderSummary(state);
  return loading ? 'Checking…' : 'Could not load search settings.';
}

export function AdvancedPanel({
  embedderApi,
  mcpAccessApi,
  initialPage = null,
}: {
  embedderApi?: EmbedderPort | undefined;
  mcpAccessApi?: McpAccessPort | undefined;
  initialPage?: 'search' | 'mcp' | null;
}) {
  const [page, setPage] = useState(initialPage);
  const content =
    page === 'search' && embedderApi ? (
      <AiIndexPanel embedderApi={embedderApi} />
    ) : page === 'mcp' && mcpAccessApi ? (
      <McpAccessPanel mcpAccessApi={mcpAccessApi} />
    ) : null;
  if (content)
    return (
      <div className="flex flex-col gap-3">
        {/* The way back is navigation, not an action: an arrow, and its box on
            the pane's own left edge so the label below it starts where the
            title does. Padding rather than a negative margin, so the hover
            pill stops at that edge too. */}
        <Button
          className="self-start px-1.5"
          leadingIcon={ArrowLeft}
          onClick={() => setPage(null)}
          size="compact"
          variant="ghost"
        >
          Back to Advanced
        </Button>
        {content}
      </div>
    );
  return (
    <SettingsPane title="Advanced">
      <SettingsList>
        {/* The row titles name each page, so both buttons say only the verb;
            their accessible names keep the two apart. */}
        <SettingsRow
          title="Search by meaning"
          detail={embedderApi && <SearchSummary embedderApi={embedderApi} />}
          trail={
            <Button
              aria-label="Configure search by meaning"
              disabled={!embedderApi}
              variant="tertiary"
              size="compact"
              onClick={() => setPage('search')}
            >
              Configure
            </Button>
          }
        />
        <SettingsRow
          title="External apps (MCP)"
          detail="Connect other AI apps to your projects."
          trail={
            <Button
              aria-label="Configure external apps"
              disabled={!mcpAccessApi}
              variant="tertiary"
              size="compact"
              onClick={() => setPage('mcp')}
            >
              Configure
            </Button>
          }
        />
      </SettingsList>
    </SettingsPane>
  );
}
