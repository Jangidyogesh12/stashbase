/**
 * The request shape every Settings endpoint is called through.
 *
 * All of them refuse the same two ways: a 400 is the reader's own request
 * coming back and reads as an invalid request, and anything else lands on the
 * shared ladder as a capability that could not be reached. Stating that once
 * means a new Settings adapter inherits the ladder instead of restating it.
 */
import { SettingsError } from '@/features/settings/application/ports';
import {
  requestOptions,
  type TransportOptions,
  type TransportRequest,
} from '@/platform/http/classify';

export interface SettingsRequestOptions {
  /** The refusal body this endpoint publishes, when it publishes one. */
  readonly failureSchema?: TransportOptions<'invalid-request'>['failureSchema'];
  readonly path: string;
  readonly signal: AbortSignal;
}

export function settingsRequest({
  failureSchema,
  path,
  signal,
}: SettingsRequestOptions): TransportRequest<'invalid-request'> {
  return requestOptions({
    error: SettingsError,
    failureSchema,
    invalidRequest: 'invalid-request',
    path,
    signal,
  });
}
