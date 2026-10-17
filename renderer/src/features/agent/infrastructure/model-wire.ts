/** The one place a wire model becomes this feature's model. The socket's
 *  catalog event and the runtime listing's remembered catalog both carry the
 *  same shape, so both adapters read it through here. Detail the runtime
 *  withheld stays a missing key rather than an undefined one; rebuild rather
 *  than widen, so nothing above this module tests for both. */
import type { AgentModel } from '@/features/agent/domain/runtime-catalog';
import type { AgentModel as AgentModelWire } from '@/protocols/agent-model';

export function toModel(wire: AgentModelWire): AgentModel {
  return {
    id: wire.id,
    label: wire.label,
    ...(wire.description === undefined ? {} : { description: wire.description }),
    ...(wire.release === undefined ? {} : { release: wire.release }),
    ...(wire.supportedEfforts === undefined ? {} : { supportedEfforts: wire.supportedEfforts }),
    ...(wire.defaultEffort === undefined ? {} : { defaultEffort: wire.defaultEffort }),
    ...(wire.isDefault === undefined ? {} : { isDefault: wire.isDefault }),
    ...(wire.relativeCost === undefined ? {} : { relativeCost: wire.relativeCost }),
  };
}
