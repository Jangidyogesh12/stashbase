/**
 * One reader-facing sentence per retrieval refusal.
 *
 * Keyword search, search by meaning, and the setup decisions all report on one
 * ladder, so a surface selects by kind instead of repeating whatever sentence
 * a transport attached. Every backend used to carry an identical fallback of
 * its own; there is one.
 */
import {
  readFailure,
  type FailureView,
  type FeatureFailureKind,
} from '@/shared/domain/feature-error';

/** Refusal only the search-by-meaning side of retrieval can meet. */
export type SemanticFailureExtra = 'not-set-up';

/** Every way a retrieval capability can refuse. */
export type RetrievalFailureKind = FeatureFailureKind<SemanticFailureExtra>;

const MESSAGES: Readonly<Record<RetrievalFailureKind, string>> = {
  'invalid-response': 'StashBase answered unexpectedly.',
  'not-set-up': 'To search by meaning, set it up in StashBase Settings.',
  'scope-lost': 'That project is no longer available in this window.',
  unauthorized: 'This window can no longer run that request.',
  unavailable: 'StashBase is unavailable.',
};

/** Setting up search by meaning is the reader's own to complete; every other refusal
 *  is a capability that could not answer. */
const INPUT_KINDS: readonly RetrievalFailureKind[] = ['not-set-up'];

/** The one sentence a reader sees for a refusal. The kind selects it, so no
 *  view has to decide how much of a transport failure to repeat. */
export function failureMessage(kind: RetrievalFailureKind): string {
  return MESSAGES[kind];
}

/** What Quick Open shows when its chunk never arrives or its render throws.
 *  Neither is a refusal on the ladder above: no search ran to report one. */
export const QUICK_OPEN_FAILED = 'Quick Open could not load.';

/** The sentence and tone for a refusal that reached a retrieval surface.
 *  Anything that is not a retrieval failure — a bug, or an error from outside
 *  the ladder — reads as the unavailable line rather than leaking its own. */
export function retrievalFailure(error: unknown): FailureView {
  return readFailure<SemanticFailureExtra>(error, MESSAGES, { inputKinds: INPUT_KINDS });
}
