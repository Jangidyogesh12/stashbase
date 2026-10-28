/** What the next turn runs on, read from the session the way the composer
 *  and the runtime verbs both need it: the explicit pick when there is one,
 *  otherwise what the runtime has said about itself. Nothing here guesses;
 *  a runtime that names no default leaves the choice empty. */
import type { AgentModel } from './runtime-catalog';
import type { AgentSessionState } from './session-state';

export interface ModelChoice {
  /** The model the next turn runs on, as far as anything has said: the
   *  explicit pick, else the model the runtime reported running, else the
   *  one the catalog flags as the runtime's own default. Null while none of
   *  those is known. */
  model: AgentModel | null;
  /** The effort the next turn runs at: the explicit pick, else the effort
   *  the chosen model declares as its default. Null while neither is known. */
  effort: string | null;
  /** The efforts the chosen model accepts; empty when it names none. */
  efforts: readonly string[];
}

/** Retain a pending preference until a catalog identifies the effective model. */
export function supportedEffort(
  state: Pick<AgentSessionState, 'activeModel' | 'effort' | 'model' | 'models'>,
  effort: string | null,
): string | null {
  const choice = modelChoice(state);
  return choice.model && effort && !choice.efforts.includes(effort) ? null : effort;
}

export function modelChoice(
  state: Pick<AgentSessionState, 'activeModel' | 'effort' | 'model' | 'models'>,
): ModelChoice {
  const byId = (id: string | null) =>
    id === null ? undefined : state.models.find((model) => model.id === id);
  const model =
    (state.model ? (byId(state.model) ?? { id: state.model, label: state.model }) : undefined) ??
    byId(state.activeModel) ??
    state.models.find((entry) => entry.isDefault);
  const efforts = model?.supportedEfforts ?? [];
  const declared = model?.defaultEffort;
  return {
    effort:
      state.effort ?? (declared !== undefined && efforts.includes(declared) ? declared : null),
    efforts,
    model: model ?? null,
  };
}
