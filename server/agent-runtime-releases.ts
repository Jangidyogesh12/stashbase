/**
 * Whether a newer release of a native runtime is out.
 *
 * An in-app update reruns the provider's official installer, so the release
 * that update would install is read from the same feed that installer reads.
 * A runtime is offered an update only when its installed version is known and
 * that feed names a newer one; an unknown version, a failed read, or a feed
 * that changed shape all read as nothing to offer, never as an update.
 *
 * Reads happen in the background: discovery answers from the last reading and
 * starts the next one when it is due, so a slow or unreachable feed never
 * holds up the runtime list. They follow the reader's automatic update check
 * choice, which also governs the app's own release checks.
 */
import { parseAgentCliVersion } from './agent-cli.ts';
import { fetchBoundedText } from './agent-runtime-installer.ts';
import type { NativeAgentId } from './agent-runtime-paths.ts';
import { getUpdatePreferences } from './app-config.ts';
import { readClaudeUserSettings } from './claude-model-catalog.ts';
import { errorMessage, logger } from './log.ts';

const log = logger('agent-releases');

const CHECK_INTERVAL_MS = 60 * 60_000;
const RETRY_INTERVAL_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

interface ReleaseFeed {
  /** Null where the provider publishes no build for this machine. */
  url(): string | null;
  maxBytes: number;
  version(body: string): string | null;
}

function jsonField(body: string, field: string): string | null {
  const value: unknown = (JSON.parse(body) as Record<string, unknown> | null)?.[field];
  return typeof value === 'string' ? value : null;
}

function antigravityPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' || platform === 'linux' ? platform : null;
  const cpu = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null;
  return os && cpu ? `${os}_${cpu}` : null;
}

/** The feeds each provider's installer script reads for the release it is
 * about to install. */
export const AGENT_RELEASE_FEEDS: Readonly<Record<NativeAgentId, ReleaseFeed>> = {
  claude: {
    // `claude install` follows the channel chosen in Claude's own settings.
    url: () => `https://downloads.claude.ai/claude-code-releases/${
      readClaudeUserSettings().autoUpdatesChannel === 'stable' ? 'stable' : 'latest'
    }`,
    maxBytes: 256,
    version: (body) => parseAgentCliVersion(body.trim()),
  },
  codex: {
    url: () => 'https://releases.openai.com/codex/channels/latest',
    maxBytes: 1_000_000,
    // Tags read `rust-v0.163.0`.
    version: (body) => parseAgentCliVersion(jsonField(body, 'tag_name')?.replace(/^rust-v/, '') ?? ''),
  },
  antigravity: {
    url: () => {
      const platform = antigravityPlatform();
      return platform
        ? `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/${platform}.json`
        : null;
    },
    maxBytes: 64_000,
    version: (body) => parseAgentCliVersion(jsonField(body, 'version') ?? ''),
  },
};

function releaseParts(version: string): { core: number[]; prerelease: string | null } {
  const [withoutBuild = ''] = version.split('+', 1);
  const dash = withoutBuild.indexOf('-');
  const core = (dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)).split('.').map(Number);
  return { core, prerelease: dash === -1 ? null : withoutBuild.slice(dash + 1) };
}

/** Whether `candidate` is a later release than `installed`. A prerelease
 * precedes its own release; anything unparseable is never newer. */
export function isNewerRelease(candidate: string, installed: string): boolean {
  const next = releaseParts(candidate);
  const current = releaseParts(installed);
  if ([...next.core, ...current.core].some((part) => !Number.isFinite(part))) return false;
  for (let index = 0; index < Math.max(next.core.length, current.core.length); index += 1) {
    const difference = (next.core[index] ?? 0) - (current.core[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  if (next.prerelease === current.prerelease) return false;
  if (next.prerelease === null) return true;
  if (current.prerelease === null) return false;
  return next.prerelease.localeCompare(current.prerelease, 'en', { numeric: true }) > 0;
}

/** Test runners never reach a provider's servers. */
function releaseChecksAllowed(environment: NodeJS.ProcessEnv = process.env): boolean {
  return !environment.NODE_TEST_CONTEXT && environment.NODE_ENV !== 'test';
}

export interface AgentReleaseCheckerOptions {
  feeds?: Readonly<Record<NativeAgentId, ReleaseFeed>>;
  fetchText?: (url: string, signal: AbortSignal, maxBytes: number) => Promise<string>;
  enabled?: () => boolean;
  now?: () => number;
}

export function createAgentReleaseChecker({
  feeds = AGENT_RELEASE_FEEDS,
  fetchText = fetchBoundedText,
  enabled = () => releaseChecksAllowed() && getUpdatePreferences().autoCheck,
  now = Date.now,
}: AgentReleaseCheckerOptions = {}) {
  const readings = new Map<NativeAgentId, { version: string | null; nextCheckAt: number }>();
  const pending = new Map<NativeAgentId, Promise<void>>();

  function check(id: NativeAgentId): Promise<void> {
    const running = pending.get(id);
    if (running) return running;
    const work = (async () => {
      const previous = readings.get(id)?.version ?? null;
      try {
        const url = feeds[id].url();
        const version = url
          ? feeds[id].version(await fetchText(url, AbortSignal.timeout(REQUEST_TIMEOUT_MS), feeds[id].maxBytes))
          : null;
        readings.set(id, { version, nextCheckAt: now() + CHECK_INTERVAL_MS });
      } catch (error) {
        log.debug(`${id} release check failed: ${errorMessage(error)}`);
        readings.set(id, { version: previous, nextCheckAt: now() + RETRY_INTERVAL_MS });
      }
    })().finally(() => pending.delete(id));
    pending.set(id, work);
    return work;
  }

  return {
    /** The newer release to offer over `installed`, from the last reading;
     *  starts the next reading when one is due. */
    availableUpdate(id: NativeAgentId, installed: string): string | null {
      if (!enabled()) return null;
      const reading = readings.get(id);
      if (!reading || now() >= reading.nextCheckAt) void check(id);
      const latest = reading?.version ?? null;
      return latest && isNewerRelease(latest, installed) ? latest : null;
    },
    /** Settles once every reading in flight has. */
    async settled(): Promise<void> {
      await Promise.all(pending.values());
    },
  };
}

export const agentReleases = createAgentReleaseChecker();
