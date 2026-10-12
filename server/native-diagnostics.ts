/** Native processes only spool diagnostics. The host remains the sole owner
 * of analytics identity, consent, queueing and network delivery. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readAppConfigStrict, type AppConfigFile } from './app-config.ts';
import { appDataRoot } from './local-data.ts';
import { writeFileAtomic } from './atomic-write.ts';
import { usageState, accountUsageId, QUEUE_TTL } from './telemetry-state.ts';
import { diagnosticSchema, errorDiagnostic } from '../shared/protocols/diagnostics.ts';
import { boundedDiagnosticContext, diagnosticContextSchema, type DiagnosticContext } from '../shared/protocols/http/telemetry.ts';

const recordSchema = z.object({
  uuid: z.string().uuid(), timestamp: z.string().datetime(), version: z.string().max(80),
  os: z.string().max(20), accountId: z.string().optional(),
  identity: z.object({ installationId: z.string().uuid(), anonymousId: z.string().uuid(),
    firstSeenAt: z.string().datetime(), userId: z.string().optional() }).optional(),
  operation: z.string().max(200), diagnostic: diagnosticSchema,
  context: diagnosticContextSchema,
}).strict();
export type NativeDiagnostic = z.infer<typeof recordSchema>;

export function createNativeDiagnostics(options: {
  available: boolean; version: string; directory?: string;
  read?: () => AppConfigFile; now?: () => number;
}) {
  const directory = options.directory ?? path.join(appDataRoot(), 'native-diagnostics');
  const read = options.read ?? readAppConfigStrict;
  const now = options.now ?? Date.now;
  const files = () => fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name)) : [];
  const clear = () => { for (const name of files()) fs.rmSync(path.join(directory, name), { force: true }); };
  return {
    clear() { try { clear(); } catch { /* Never block preference changes. */ } },
    record(error: unknown, operation: string, context: DiagnosticContext = {}) {
      try {
        if (!options.available) return;
        const config = read();
        const state = usageState(config, now());
        if (!state.enabled) { clear(); return; }
        if (files().length >= 50) return;
        const identity = state.userId === accountUsageId(config) && state.installationId && state.anonymousId && state.firstSeenAt
          ? { installationId: state.installationId, anonymousId: state.anonymousId, firstSeenAt: state.firstSeenAt,
            ...(accountUsageId(config) ? { userId: accountUsageId(config) } : {}) } : undefined;
        const record = recordSchema.parse({ uuid: randomUUID(), timestamp: new Date(now()).toISOString(),
          version: options.version, os: process.platform, accountId: accountUsageId(config), identity,
          operation, diagnostic: errorDiagnostic(error), context: boundedDiagnosticContext(context) });
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const file = path.join(directory, `${record.uuid}.json`);
        writeFileAtomic(file, JSON.stringify(record), { mode: 0o600 });
      } catch { /* A broken host must not make crash reporting fatal. */ }
    },
    drain(accept: (record: NativeDiagnostic) => boolean) {
      try {
        if (!options.available) return;
        const config = read();
        if (!usageState(config, now()).enabled) { clear(); return; }
        for (const name of files()) {
          const file = path.join(directory, name);
          let remove = false;
          try {
            if (fs.statSync(file).size > 200_000) { remove = true; continue; }
            const record = recordSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
            const age = now() - Date.parse(record.timestamp);
            // Without a previously allocated identity, do not attribute an old
            // startup failure to an account that signed in afterward.
            remove = age > QUEUE_TTL || age < -60_000
              || (!record.identity && record.accountId !== accountUsageId(config)) || accept(record);
          } catch { remove = true; }
          finally { if (remove) fs.rmSync(file, { force: true }); }
        }
      } catch { /* Retry after the host or filesystem recovers. */ }
    },
  };
}
