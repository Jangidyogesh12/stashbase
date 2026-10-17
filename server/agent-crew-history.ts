/** Crew call attribution lives alongside native history. No prompt or output
 * is copied here, and replay never consults the current service catalog. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { agentCrewCallSchema, type AgentCrewCall } from '../shared/protocols/http/agent-tools.ts';
import { appDataRoot } from './local-data.ts';
import { writeFileAtomic } from './atomic-write.ts';

function file(session: string): string {
  return path.join(appDataRoot(), 'agent-crew-calls', `${createHash('sha256').update(session).digest('hex')}.json`);
}

export function crewCallHistory(session: string): Record<string, AgentCrewCall> {
  let data: unknown;
  try { data = JSON.parse(fs.readFileSync(file(session), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Crew call history is invalid.');
  return Object.fromEntries(Object.entries(data).map(([id, value]) => [id, agentCrewCallSchema.parse(value)]));
}

export function recordCrewCall(session: string, call: string, crew: AgentCrewCall): void {
  const target = file(session);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeFileAtomic(target, JSON.stringify({ ...crewCallHistory(session), [call]: crew }));
}

export function forgetCrewCalls(session: string): void {
  fs.rmSync(file(session), { force: true });
}
