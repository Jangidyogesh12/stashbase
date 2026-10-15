/** Default's Crew control. Its main agent's model is fixed, so the reader
 *  chooses no model; what the reader chooses is which crew members it may
 *  hand work to (a writer, a reviewer, a test reader, a humanizer), each a
 *  tool on a stronger model. Any of them may be on together, and every one
 *  starts off. The menu opens on all of them, one toggle row each: the row
 *  turns its member on or off, and the model named on its second line is a
 *  button one layer deeper, so the reader sees which model a member runs on
 *  before turning it on and changes it without leaving the list. A change
 *  reconnects the chat so its next turn runs with it. */
import { ChevronLeft, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  DropdownContent,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
} from '@/components/ui/dropdown';
import { MenuItem } from '@/components/ui/menu-item';
import type { AgentTool, AgentToolsPort } from '@/features/agent/application/ports';
import { useAgentTools, type AgentToolsView } from '@/features/agent/hooks/use-agent-tools';
import { agentToolIcon } from '@/features/agent/ui/tool-icon';

import { ComposerMenuTrigger } from './menu-trigger';
import { NARROW_LABEL, NARROW_TRIGGER } from './narrow';

export interface AgentToolsControlProps {
  readonly disabled: boolean;
  readonly api: AgentToolsPort;
  readonly chat: string;
  onSaving?(saving: boolean): void;
  /** Reconnects the chat so the change applies from its next turn. */
  onChanged(): void;
}

type Layer = { readonly kind: 'tools' } | { readonly kind: 'model'; readonly id: AgentTool['id'] };

const TOOLS: Layer = { kind: 'tools' };

function toolIcon(tool: AgentTool) {
  return agentToolIcon(tool.icon);
}

function optionLabel(tool: AgentTool, id: string | null): string {
  return tool.options.find((option) => option.id === id)?.label ?? id ?? '';
}

/** The first layer: every catalog tool as a toggle row, its name and a
 *  second line that names its model and leads to the model
 *  list. A tool that cannot be used says why instead; one that needs a model
 *  says so on that line, which still leads to the list. */
function ToolsLayer({ go, view }: { go(layer: Layer): void; view: AgentToolsView }) {
  if (view.loading || view.tools.length === 0) {
    return (
      <DropdownLabel>
        {view.loading ? 'Loading the crew…' : 'The crew is unavailable'}
      </DropdownLabel>
    );
  }
  return (
    <>
      <DropdownLabel className="font-medium text-foreground">Crew</DropdownLabel>
      {/* Said as picking who comes along: the rows below already name what
          each member does, and new chats start from the same picks. */}
      <p className="-mt-1 px-2 pb-1.5 text-caption text-muted-foreground">
        Pick who's on your crew for this chat. New chats start with the same crew.
      </p>
      {view.tools.map((tool) => {
        if (tool.unavailable) {
          return (
            <MenuItem
              description={tool.unavailable}
              disabled={view.saving || !tool.enabled}
              icon={toolIcon(tool)}
              key={tool.id}
              label={tool.label}
              onSelect={() => view.change(tool.id, { enabled: false })}
              switched={tool.enabled}
            />
          );
        }
        const model =
          tool.model === null
            ? (tool.modelProblem ?? 'Choose a model')
            : optionLabel(tool, tool.model);
        return (
          <MenuItem
            closeOnClick={false}
            description={model}
            descriptionAction={{
              label: `${tool.label} model: ${model}`,
              onSelect: () => go({ kind: 'model', id: tool.id }),
            }}
            icon={toolIcon(tool)}
            disabled={view.saving}
            key={tool.id}
            label={tool.label}
            onSelect={() => view.change(tool.id, { enabled: !tool.enabled })}
            switched={tool.enabled}
          />
        );
      })}
    </>
  );
}

/** One crew member's models under its summary, its default marked. A pick
 *  returns to the list, where the row now names it; it does not turn the
 *  member on or off. */
function ModelLayer({
  go,
  tool,
  view,
}: {
  go(layer: Layer): void;
  tool: AgentTool;
  view: AgentToolsView;
}) {
  return (
    <>
      <MenuItem closeOnClick={false} icon={ChevronLeft} label="Back" onSelect={() => go(TOOLS)} />
      <DropdownSeparator />
      {tool.summary && (
        <p className="px-2 pt-1.5 text-body text-foreground">{`${tool.label}: ${tool.summary}`}</p>
      )}
      <DropdownLabel>Model</DropdownLabel>
      {tool.options.map((option) => (
        <MenuItem
          checked={option.id === tool.model}
          closeOnClick={false}
          {...(option.id === tool.defaultModel ? { badge: 'Recommended' } : {})}
          {...(option.reason ? { description: option.reason } : {})}
          disabled={view.saving || !option.available}
          key={option.id}
          label={option.label}
          onSelect={() => {
            if (option.id !== tool.model) view.change(tool.id, { model: option.id });
            go(TOOLS);
          }}
        />
      ))}
    </>
  );
}

export function AgentToolsControl({
  api,
  chat,
  disabled,
  onChanged,
  onSaving,
}: AgentToolsControlProps) {
  const view = useAgentTools(api, chat, onChanged);
  useEffect(() => {
    onSaving?.(view.saving);
    return () => onSaving?.(false);
  }, [onSaving, view.saving]);
  const [layer, setLayer] = useState<Layer>(TOOLS);
  // The trigger always reads Crew; who is on is in its tooltip and the menu.
  const on = view.tools.filter((entry) => entry.enabled).map((entry) => entry.label);
  const label = `Crew: ${on.length === 0 ? 'None' : on.join(', ')}`;
  const tool =
    layer.kind === 'model' ? view.tools.find((entry) => entry.id === layer.id) : undefined;
  return (
    <DropdownMenu
      disabled={disabled}
      onOpenChange={(open) => {
        // Reset on open only: resetting on close would swap the layer while
        // the popup is still springing shut.
        if (open) {
          setLayer(TOOLS);
          view.retryLoading();
        }
      }}
    >
      <ComposerMenuTrigger
        className={NARROW_TRIGGER}
        disabled={disabled}
        icon={UsersRound}
        label={label}
      >
        <span className={NARROW_LABEL}>Crew</span>
      </ComposerMenuTrigger>
      <DropdownContent
        align="end"
        className="w-72 max-w-[calc(100vw-1rem)]"
        selectionAppearance="none"
        side="top"
      >
        {view.error && (
          <p className="px-2 py-1 text-caption text-destructive" role="alert">
            {view.error}
          </p>
        )}
        {tool ? (
          <ModelLayer go={setLayer} tool={tool} view={view} />
        ) : (
          <ToolsLayer go={setLayer} view={view} />
        )}
      </DropdownContent>
    </DropdownMenu>
  );
}
