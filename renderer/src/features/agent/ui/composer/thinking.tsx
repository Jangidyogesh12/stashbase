/** The composer's model-and-thinking control: one trigger naming the model
 *  the next turn runs on and how hard it thinks, over a menu that opens on
 *  the thinking level and keeps the model list one layer deeper. The level is
 *  the thing a reader changes turn to turn; the model is chosen once. It sits
 *  at the composer's right edge beside Send, where the reader looks last
 *  before sending; the runtime, its permission mode, and the persona keep
 *  the left. */
import { ChevronDown, ChevronLeft, ChevronRight, Lock, RefreshCw, Zap } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownContent,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { MenuItem } from '@/components/ui/menu-item';
import { Tooltip } from '@/components/ui/tooltip';
import type { Agent } from '@/features/agent/domain/agent-catalog';
import { modelChoice, type ModelChoice } from '@/features/agent/domain/model-choice';
import type { AgentModel } from '@/features/agent/domain/runtime-catalog';
import type { AgentSessionState } from '@/features/agent/domain/session';
import type { AgentRuntimeUpdateView } from '@/features/agent/hooks/use-agent-runtime-update';
import { cn } from '@/lib/utils';

import { NARROW_LABEL, NARROWEST_LABEL, NARROWEST_TRIGGER } from './narrow';

type Layer = 'effort' | 'model';

type ThinkingState = Pick<AgentSessionState, 'activeModel' | 'effort' | 'model' | 'models'>;

function effortLabel(effort: string): string {
  return effort
    .replace(/^xhigh$/u, 'Extra high')
    .replace(/[-_]+/gu, ' ')
    .replace(/^./u, (letter) => letter.toUpperCase());
}

/** A model priced well above the runtime's default is locked for now: the
 *  row stays listed with its cost multiple and a lock, but cannot be chosen,
 *  so readers stay on the default. */
function costLock(model: AgentModel): { badge: string } | null {
  const cost = model.relativeCost;
  return cost !== undefined && cost >= 1.5 ? { badge: `${Math.round(cost)}× cost` } : null;
}

function effortDescription(effort: string): string | undefined {
  switch (effort.toLowerCase()) {
    case 'low':
      return 'Faster';
    case 'medium':
      return 'Balanced';
    case 'high':
      return 'Deeper reasoning';
    case 'xhigh':
      return 'Deepest reasoning';
    case 'max':
      return 'Maximum reasoning';
    case 'ultra':
      return 'Maximum reasoning with delegation';
    default:
      return undefined;
  }
}

export interface AgentThinkingControlProps {
  activeAgent: Agent;
  state: ThinkingState &
    Pick<AgentSessionState, 'transcript'> & {
      /** Whether a turn is streaming; model and level are fixed for its run. */
      activeTurn: boolean;
    };
  onEffortChange(effort: string | null): void;
  onModelChange(model: string | null): void;
  /** Called when the trigger is pressed, so the catalog can be re-read. */
  onRequestCatalog(): void;
  runtimeUpdate?: AgentRuntimeUpdateView | undefined;
}

/** The first layer: the levels the chosen model accepts, with the model row
 *  at the foot leading one layer deeper. A model that declares no default
 *  level keeps a Default row, because the runtime's own level is then the
 *  only way back to it. */
function EffortLayer({
  choice,
  modelLocked,
  modelName,
  models,
  onEffortChange,
  onModelLayer,
}: {
  choice: ModelChoice;
  modelLocked: boolean;
  modelName: string;
  models: boolean;
  onEffortChange(effort: string | null): void;
  onModelLayer(): void;
}) {
  const declared = choice.model?.defaultEffort;
  const hasDeclaredDefault = declared !== undefined && choice.efforts.includes(declared);
  return (
    <>
      <DropdownLabel>
        {choice.efforts.length === 0 ? 'Thinking is set by the runtime' : 'Thinking'}
      </DropdownLabel>
      {choice.efforts.length > 0 && !hasDeclaredDefault && (
        <MenuItem
          checked={choice.effort === null}
          label="Default"
          onSelect={() => onEffortChange(null)}
        />
      )}
      {choice.efforts.map((effort) => {
        const description = effortDescription(effort);
        return (
          <MenuItem
            checked={effort === choice.effort}
            {...(description === undefined ? {} : { description })}
            key={effort}
            label={effortLabel(effort)}
            layout="inline"
            onSelect={() => onEffortChange(effort)}
          />
        );
      })}
      {models && (
        <>
          <DropdownSeparator />
          <MenuItem
            closeOnClick={false}
            description={modelName}
            disabled={modelLocked}
            label="Model"
            layout="inline"
            onSelect={onModelLayer}
            trailingIcon={ChevronRight}
          />
        </>
      )}
    </>
  );
}

/** The deeper layer: the catalog, newest first as the runtime lists it. The
 *  row that will run is marked whether it was picked or is the runtime's own
 *  default; a runtime that names no default keeps a Default row for the same
 *  reason the level list does. A model pick closes the menu, because it is
 *  made once and the reader came down a layer to make it; a level pick keeps
 *  the menu open the way every choice menu here does, so the check can be
 *  seen before the pointer leaves. */
function ModelLayer({
  choice,
  effort,
  onEffortLayer,
  onModelChange,
  runtimeUpdate,
  state,
}: {
  choice: ModelChoice;
  effort: boolean;
  onEffortLayer(): void;
  onModelChange(model: string | null): void;
  runtimeUpdate?: AgentRuntimeUpdateView | undefined;
  state: ThinkingState;
}) {
  const runtimeNamesDefault =
    state.activeModel !== null || state.models.some((model) => model.isDefault === true);
  return (
    <>
      {effort && (
        <MenuItem closeOnClick={false} icon={ChevronLeft} label="Back" onSelect={onEffortLayer} />
      )}
      <DropdownLabel>Model</DropdownLabel>
      {!runtimeNamesDefault && (
        <MenuItem
          checked={choice.model === null}
          closeOnClick
          disabled={runtimeUpdate?.busy === true}
          label="Default"
          layout="wrap"
          onSelect={() => onModelChange(null)}
        />
      )}
      {state.models.map((model) => {
        const lock = costLock(model);
        return (
          <MenuItem
            checked={model.id === choice.model?.id}
            closeOnClick
            disabled={runtimeUpdate?.busy === true || lock !== null}
            // A runtime's model labels are aliases: "Opus" is whichever Opus
            // that build runs. The release it resolves to is in the runtime's
            // own description, which is the only place a reader can see that
            // their Opus is now 5.5, so the rows carry it the way the levels
            // above them already do.
            {...(model.description === undefined ? {} : { description: model.description })}
            {...(lock === null ? {} : { badge: lock.badge, trailingIcon: Lock })}
            key={model.id}
            label={model.label}
            layout="wrap"
            onSelect={() => onModelChange(model.id)}
          />
        );
      })}
      {runtimeUpdate && (
        <>
          <DropdownSeparator />
          {/* An action, not a choice: one line under its icon like Back,
              so it does not outweigh the models it sits beneath. */}
          <MenuItem
            closeOnClick={false}
            disabled={runtimeUpdate.busy}
            icon={RefreshCw}
            label={
              runtimeUpdate.busy
                ? `Updating ${runtimeUpdate.label}…`
                : `Update ${runtimeUpdate.label}`
            }
            onSelect={() => runtimeUpdate.update()}
          />
          {runtimeUpdate.failure && (
            <DropdownLabel role="alert">{runtimeUpdate.failure}</DropdownLabel>
          )}
        </>
      )}
    </>
  );
}

/** Renders nothing for a runtime that advertises neither a model nor a level
 *  choice, so the caller places it without asking. */
export function AgentThinkingControl({
  activeAgent,
  onEffortChange,
  onModelChange,
  onRequestCatalog,
  runtimeUpdate,
  state,
}: AgentThinkingControlProps) {
  const { effort, models } = activeAgent.abilities;
  const disabled = state.activeTurn;
  // A populated Claude conversation keeps its model for the rest of its run.
  const modelLocked = activeAgent.id === 'claude' && state.transcript.length > 0;
  const choice = modelChoice(state);
  const firstLayer: Layer = effort ? 'effort' : 'model';
  const [layer, setLayer] = useState<Layer>(firstLayer);
  const modelName = choice.model?.label ?? 'Default';
  const effortName = choice.effort === null ? null : effortLabel(choice.effort);
  const reading = effortName === null ? modelName : `${modelName}, ${effortName}`;
  const label = `Model and thinking: ${reading}`;

  if (!effort && !models) return null;

  return (
    <DropdownMenu
      disabled={disabled}
      onOpenChange={(open) => {
        if (open) setLayer(firstLayer);
      }}
    >
      <Tooltip content={label} side="top">
        <DropdownTrigger
          render={
            <Button
              aria-label={label}
              className={cn('max-w-56', NARROWEST_TRIGGER)}
              disabled={disabled}
              leadingIcon={Zap}
              onClick={onRequestCatalog}
              size="compact"
              trailingIcon={ChevronDown}
              variant="ghost"
            >
              {/* As the pane narrows the model's name folds away first and the
                  level, the thing changed turn to turn, stays until the
                  narrowest step. While no level is known, before the catalog
                  has been read, the name stays in its place instead, so the
                  trigger is never a bare icon above the narrowest step. */}
              <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                <span
                  className={cn(
                    'min-w-0 truncate',
                    effortName === null ? NARROWEST_LABEL : NARROW_LABEL,
                  )}
                >
                  {modelName}
                </span>
                {effortName !== null && (
                  <span className={cn('shrink-0 text-muted-foreground', NARROWEST_LABEL)}>
                    {effortName}
                  </span>
                )}
              </span>
            </Button>
          }
        />
      </Tooltip>
      <DropdownContent
        align="end"
        className="w-72 max-w-[calc(100vw-1rem)]"
        selectionAppearance="none"
        side="top"
      >
        {layer === 'effort' ? (
          <EffortLayer
            choice={choice}
            modelLocked={modelLocked}
            modelName={modelName}
            models={models}
            onEffortChange={onEffortChange}
            onModelLayer={() => setLayer('model')}
          />
        ) : (
          <ModelLayer
            choice={choice}
            effort={effort}
            onEffortLayer={() => setLayer('effort')}
            onModelChange={onModelChange}
            runtimeUpdate={runtimeUpdate}
            state={state}
          />
        )}
      </DropdownContent>
    </DropdownMenu>
  );
}
