import type { TelemetryPort } from '@/features/settings/application/telemetry-port';
import { settingsRequest } from '@/features/settings/infrastructure/settings-request';
import { request } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import { telemetryFailureSchema, telemetryPreferencesSchema } from '@/protocols/http/telemetry';

const options = (signal: AbortSignal) =>
  settingsRequest({
    failureSchema: telemetryFailureSchema,
    path: '/api/telemetry',
    signal,
  });

export function createTelemetryAdapter(client: HttpClient): TelemetryPort {
  return {
    load: (signal) => request(client, { ...options(signal), schema: telemetryPreferencesSchema }),
    update: (change, signal) =>
      request(client, {
        ...options(signal),
        body: change,
        method: 'PUT',
        schema: telemetryPreferencesSchema,
      }),
  };
}
