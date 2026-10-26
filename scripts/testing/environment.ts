import path from 'node:path';
import { NATIVE_AGENTS } from '../../server/native-agents.ts';

/** Shared by host tests, profiling and explicit onboarding validation.
 * Private state alone is insufficient: inherited CLI overrides and PATH
 * discovery can start a real provider in a signed-out temporary home. */
export function isolatedEnvironment(root: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    HOME: path.join(root, 'home'),
    USERPROFILE: path.join(root, 'home'),
    APPDATA: path.join(root, 'config'),
    LOCALAPPDATA: path.join(root, 'data'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'),
    STASHBASE_LOCAL_DATA_ROOT: path.join(root, 'data', 'stashbase'),
    STASHBASE_ISOLATED_AGENTS: '1',
    STASHBASE_TELEMETRY_DISABLED: '1',
  };
  for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', ...Object.values(NATIVE_AGENTS).flatMap((spec) => spec.envNames)]) {
    delete env[key];
  }
  return env;
}
