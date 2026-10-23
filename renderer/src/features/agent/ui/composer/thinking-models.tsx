/** The model menu one step under the thinking panel, and the names the
 *  control gives a model. */
import { RefreshCw } from 'lucide-react';
import type { RefObject } from 'react';

import { DropdownContent, DropdownLabel } from '@/components/ui/dropdown';
import { MenuItem } from '@/components/ui/menu-item';
import type { ModelChoice } from '@/features/agent/domain/model-choice';
import type { AgentModel } from '@/features/agent/domain/runtime-catalog';
import type { AgentSessionState } from '@/features/agent/domain/session';
import type { AgentRuntimeUpdateView } from '@/features/agent/hooks/use-agent-runtime-update';

export type ThinkingState = Pick<AgentSessionState, 'activeModel' | 'effort' | 'model' | 'models'>;

/** A label without the parenthetical a runtime appends to it. */
function bareLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/u, '').trim() || label;
}

/** A model's name without the parenthetical a runtime appends to it ("Opus
 *  (1M context)", "Default (recommended)"); the detail is in its
 *  description. The whole label stays where dropping the parenthetical
 *  would leave two models with one name. */
function modelLabel(model: AgentModel, models: readonly AgentModel[]): string {
  const name = bareLabel(model.label);
  const shared = models.some((other) => other.id !== model.id && bareLabel(other.label) === name);
  return shared ? model.label : name;
}

/** What the trigger and the panel call the model: the release an alias
 *  resolves to where the runtime says one ("Opus 5.5"), else its name. */
export function modelDisplayName(model: AgentModel | null, models: readonly AgentModel[]): string {
  if (model === null) return 'Default';
  return model.release ?? modelLabel(model, models);
}

/** The model list: the catalog, newest first as the runtime lists it. The
 *  row that will run is marked whether it was picked or is the runtime's own
 *  default; a runtime that names no default keeps a Default row, because the
 *  runtime's own model is then the only way back to it. A pick closes the
 *  control, because a model is chosen once. */
interface ModelListProps {
  choice: ModelChoice;
  onModelChange(model: string | null): void;
  runtimeUpdate?: AgentRuntimeUpdateView | undefined;
  state: ThinkingState;
}

function ModelList({ choice, onModelChange, runtimeUpdate, state }: ModelListProps) {
  const runtimeNamesDefault =
    state.activeModel !== null || state.models.some((model) => model.isDefault === true);
  return (
    <>
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
      {state.models.map((model) => (
        <MenuItem
          checked={model.id === choice.model?.id}
          closeOnClick
          disabled={runtimeUpdate?.busy === true}
          // A runtime's model labels are aliases: "Opus" is whichever Opus
          // that build runs. The release it resolves to is in the runtime's
          // own description, which is the only place a reader can see that
          // their Opus is now 5.5, so the rows carry it.
          {...(model.description === undefined ? {} : { description: model.description })}
          key={model.id}
          label={modelLabel(model, state.models)}
          layout="wrap"
          onSelect={() => onModelChange(model.id)}
        />
      ))}
    </>
  );
}

/** The runtime's update, pinned under the list so a long list never scrolls
 *  it out of view. An action, not a choice: one line under its icon, so it
 *  does not outweigh the models it sits beneath. */
function RuntimeUpdateRow({ runtimeUpdate }: { runtimeUpdate: AgentRuntimeUpdateView }) {
  return (
    <>
      <MenuItem
        closeOnClick={false}
        disabled={runtimeUpdate.busy}
        icon={RefreshCw}
        label={
          runtimeUpdate.busy ? `Updating ${runtimeUpdate.label}…` : `Update ${runtimeUpdate.label}`
        }
        onSelect={() => runtimeUpdate.update()}
      />
      {runtimeUpdate.busy && runtimeUpdate.progress && (
        <DropdownLabel aria-live="polite" className="line-clamp-2 wrap-anywhere">
          {runtimeUpdate.progress}
        </DropdownLabel>
      )}
      {runtimeUpdate.failure && <DropdownLabel role="alert">{runtimeUpdate.failure}</DropdownLabel>}
    </>
  );
}

/** The model list as a menu above the composer. Opened from the thinking
 *  panel it rises above the whole panel (`anchor`) rather than covering the
 *  name it opened from; with no level to set, the trigger opens it directly. */
export function ModelMenu({
  anchor,
  ...list
}: ModelListProps & { anchor?: RefObject<HTMLDivElement | null> }) {
  return (
    <DropdownContent
      align="end"
      className="w-72 max-w-[calc(100vw-1rem)]"
      selectionAppearance="none"
      side="top"
      {...(anchor ? { anchor, sideOffset: 6 } : {})}
      {...(list.runtimeUpdate
        ? { footer: <RuntimeUpdateRow runtimeUpdate={list.runtimeUpdate} /> }
        : {})}
    >
      <ModelList {...list} />
    </DropdownContent>
  );
}
