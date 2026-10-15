import { agentProcessExitDiagnostic } from './agent-process.ts';
/**
 * App-scoped owner of the pinned OpenCode headless server.
 *
 * This is deliberately the only module that knows where the bundled binary
 * lives, which environment isolates its state, or how its native SDK is
 * authenticated. Agent adapters receive a directory-scoped client and keep
 * the renderer on StashBase's stable Agent protocol.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import {
  createOpencodeClient,
  type Config,
  type OpencodeClient,
} from '@opencode-ai/sdk';
import type { Config as NativeConfig } from '@opencode-ai/sdk/v2/types';
import { getHostedAccountSession } from './app-config.ts';
import { ensureMcpLauncher } from './agent-mcp.ts';
import { resolveAgentPersona } from './agent-persona.ts';
import { composeAgentRuntimeInstructions } from './agent-runtime-instructions.ts';
import { agentCliPath } from './agent-cli.ts';
import { appDataRoot } from './local-data.ts';
import { logger } from './log.ts';
import {
  hostedAgentRuntime,
  hostedAgentDiagnostic,
  beginHostedAgentTurn,
  completeHostedAgentModel,
  completeHostedAgentTool,
  endHostedAgentTurn,
  releaseHostedAgentChannel,
  startHostedAgentBroker,
  stopHostedAgentBroker,
  HostedAgentToolError,
  type HostedAgentTurnModel,
} from './hosted-agent-broker.ts';
import {
  defaultHostedAgentProfile,
  fetchHostedAgentProfiles,
  type HostedAgentProfile,
} from './hosted-agent-models.ts';
import type { AgentRuntimeDescriptor } from './agent-contract.ts';
import {
  agentToolPrompt,
  agentToolSelection,
  defaultAgentToolInstructions,
  defaultAgentToolViews,
  crewChatChoices,
  enabledAgentTools,
  mcpAgentTools,
  runToolInTurn,
  type AgentToolResult,
  type EnabledAgentTool,
  type TurnToolSnapshot,
} from './default-agent-tools.ts';
import { latestToolCatalog, type ToolCatalog } from './agent-tool-catalog.ts';
import { OpenCodeWarmSlot } from './opencode-warm-slot.ts';
import { filesystemPath } from './filesystem-path.ts';

const log = logger('opencode-runtime');
export const BUNDLED_OPENCODE_VERSION = '1.18.19';
const START_TIMEOUT_MS = 15_000;
const OPEN_CODE_RUNTIME_ENV_KEYS = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
  'TMP', 'TEMP', 'TMPDIR',
  'LANG', 'LANGUAGE', 'TZ', 'TERM', 'COLORTERM', 'SHELL',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'DYLD_FALLBACK_LIBRARY_PATH',
]);

interface RunningOpenCode {
  process: ChildProcessByStdio<null, Readable, Readable>;
  url: string;
  authorization: string;
}

function unpackedPath(file: string): string {
  return file.includes(`${path.sep}app.asar${path.sep}`)
    ? file.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : file;
}

/** Resolve only the package-owned postinstall target. We never fall back to
 * PATH: a user's unrelated OpenCode version must not change this adapter. */
export function bundledOpenCodeExecutable(): string | null {
  const resourcesRoot = process.env.STASHBASE_RESOURCES_PATH?.trim();
  const root = process.env.STASHBASE_APP_ROOT?.trim()
    ? path.resolve(process.env.STASHBASE_APP_ROOT)
    : path.resolve(process.cwd());
  const candidates = [
    ...(resourcesRoot
      ? [path.join(path.resolve(resourcesRoot), 'opencode', 'opencode.exe')]
      : []),
    unpackedPath(path.join(root, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')),
  ];
  try {
    const packageJson = createRequire(import.meta.url).resolve('opencode-ai/package.json');
    candidates.push(unpackedPath(path.join(path.dirname(packageJson), 'bin', 'opencode.exe')));
  } catch {
    // Package verification reports the stable missing-runtime failure below.
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** Native OpenCode skill reads use ripgrep. Keep Windows independent of a
 * user's PATH and of OpenCode's on-demand binary download. */
export function bundledOpenCodeRipgrep(): string | null {
  if (process.platform !== 'win32') return null;
  const resourcesRoot = process.env.STASHBASE_RESOURCES_PATH?.trim();
  if (resourcesRoot) {
    const packaged = path.join(path.resolve(resourcesRoot), 'opencode', 'rg.exe');
    if (fs.existsSync(packaged)) return packaged;
  }
  try {
    const { rgPath } = createRequire(import.meta.url)('@vscode/ripgrep') as { rgPath: string };
    if (fs.existsSync(rgPath)) return rgPath;
  } catch {
    // The stable failure below is preferable to a runtime download or hang.
  }
  return null;
}

async function availablePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve an OpenCode port.'));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

/** Keep only process plumbing needed to launch the bundled runtime. Provider
 * credentials, user OpenCode settings, proxy credentials, and Electron/Node
 * injection flags must never cross into the private Agent process. */
export function safeOpenCodeInheritedEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(Object.entries(source).filter(([name]) => {
    const upper = name.toUpperCase();
    return upper === 'STASHBASE_TELEMETRY_DISABLED' || OPEN_CODE_RUNTIME_ENV_KEYS.has(upper) || upper.startsWith('LC_');
  }));
  // Desktop launches omit common CLI directories. Keep the credential filter,
  // but give native shell tools the same executable search path as our other Agents.
  const inheritedPath = Object.entries(environment).find(([name]) => name.toUpperCase() === 'PATH')?.[1];
  for (const name of Object.keys(environment)) if (name.toUpperCase() === 'PATH') delete environment[name];
  return { ...environment, PATH: agentCliPath([], inheritedPath ?? '') };
}

export function openCodeRuntimeEnvironment(
  config: Config,
  username: string,
  password: string,
  root = path.join(appDataRoot(), 'opencode'),
  source = process.env,
): NodeJS.ProcessEnv {
  for (const name of ['data', 'config', 'cache', 'home']) fs.mkdirSync(path.join(root, name), { recursive: true });
  const inherited = safeOpenCodeInheritedEnvironment(source);
  const ripgrep = process.platform === 'win32' ? bundledOpenCodeRipgrep() : null;
  if (process.platform === 'win32' && !ripgrep) {
    throw new Error('Bundled Windows ripgrep is missing from the OpenCode runtime.');
  }
  return {
    ...inherited,
    ...(ripgrep ? { PATH: `${path.dirname(ripgrep)}${path.delimiter}${inherited.PATH ?? ''}` } : {}),
    // A private HOME isolates global configuration. The native discovery flags
    // also prevent walking out of a plain writing folder (whose worktree is /).
    HOME: path.join(root, 'home'),
    USERPROFILE: path.join(root, 'home'),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_SERVER_USERNAME: username,
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    XDG_DATA_HOME: path.join(root, 'data'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
  };
}

const modelAbilities = () => ({
  attachment: true,
  modalities: { input: ['text', 'image', 'pdf'] as Array<'text' | 'image' | 'pdf'>, output: ['text'] as Array<'text'> },
  tool_call: true,
  reasoning: true,
});

/** One OpenCode model per hosted profile, so each stored message names the
 * profile it ran on and compaction follows that profile's own limits. With no
 * readable list, the broker's unversioned default stands in, as it did before
 * profiles existed. */
function openCodeModels(
  fallback: string,
  profiles: readonly HostedAgentProfile[],
): NonNullable<NonNullable<Config['provider']>[string]['models']> {
  if (profiles.length === 0) return { [fallback]: { name: 'StashBase Agent', ...modelAbilities() } };
  return Object.fromEntries(profiles.map((profile) => [profile.id, {
    name: profile.displayName,
    ...modelAbilities(),
    limit: { context: profile.contextTokenLimit, output: profile.outputTokenLimit },
  }]));
}

export function buildOpenCodeConfig(
  model: { apiKey: string; baseUrl: string; model: string },
  mcp: string,
  mcpEnvironment: Record<string, string> = {},
  persona?: string,
  profiles: readonly HostedAgentProfile[] = [],
  directory?: string,
  tools: readonly EnabledAgentTool[] = [],
): Config & Pick<NativeConfig, 'skills'> {
  // The tools that are on add how to brief them and each one's standing
  // rule to the main agent's instructions; the tools' own models never see
  // them.
  const runtimeInstructions = [
    'You are StashBase\'s general-purpose assistant. Help the user think, research, write, and revise. Follow the requested scope, format, language, and working style. Use tools when they help the task; an empty project and a conversation without file changes are valid. Distinguish supported facts from assumptions and never invent sources. Complete the requested work and explain any remaining blocker concisely.',
    composeAgentRuntimeInstructions(persona),
    defaultAgentToolInstructions(tools),
  ].filter(Boolean).join('\n\n');
  const toolPermissions = Object.fromEntries(tools.map(({ tool }) => [`stashbase_${tool.agent.toolName}`, 'allow']));
  // Disabling native upward config discovery also disables its instruction-file
  // lookup. Preserve the native filename precedence inside this project, passing
  // the path so OpenCode still owns reading and presenting the instructions.
  const instruction = directory && ['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md']
    .map((name) => path.resolve(directory, name)).find((file) => fs.existsSync(file));
  const defaultModel = defaultHostedAgentProfile(profiles)?.id ?? model.model;
  const permission = {
    // Native edit/write/patch tools share this permission; MCP writes stay explicit.
    edit: 'deny',
    bash: 'ask',
    webfetch: 'ask',
    doom_loop: 'ask',
    external_directory: 'ask',
    stashbase_write_file: 'ask',
    stashbase_edit_file: 'ask',
    stashbase_move_file: 'ask',
    stashbase_delete_file: 'ask',
    stashbase_create_project: 'ask',
    // OpenCode's own sub-agents would rerun the main model with the whole
    // runtime context; Default's other models are tools instead.
    task: 'deny',
    ...toolPermissions,
  } as NonNullable<Config['permission']> & Record<string, 'ask' | 'allow' | 'deny'>;
  return {
    autoupdate: false,
    share: 'disabled',
    enabled_providers: ['stashbase'],
    skills: { paths: ['.agents/skills', '.claude/skills', '.opencode/skills', '.opencode/skill'] },
    ...(instruction ? { instructions: [instruction] } : {}),
    model: `stashbase/${defaultModel}`,
    small_model: `stashbase/${defaultModel}`,
    provider: {
      stashbase: {
        name: 'StashBase',
        npm: '@ai-sdk/openai-compatible',
        options: {
          apiKey: model.apiKey,
          baseURL: model.baseUrl,
          timeout: false,
        },
        models: openCodeModels(model.model, profiles),
      },
    },
    mcp: {
      stashbase: {
        type: 'local',
        command: [mcp],
        ...(Object.keys(mcpEnvironment).length || tools.length ? {
          environment: {
            ...mcpEnvironment,
            // The MCP host registers only the tools enabled for this
            // session, by the catalog's names and descriptions.
            ...(tools.length ? { STASHBASE_AGENT_TOOLS: JSON.stringify(mcpAgentTools(tools)) } : {}),
          },
        } : {}),
        enabled: true,
        timeout: 10_000,
      },
    },
    agent: {
      'stashbase-folder': {
        description: 'The StashBase Agent for one authorized project folder.',
        mode: 'primary',
        prompt: runtimeInstructions,
      },
      'stashbase-edit': {
        description: 'Edit project documents; ask before commands and other actions.',
        mode: 'primary',
        prompt: runtimeInstructions,
      },
      'stashbase-plan': {
        description: 'Explore the project without changing files or running commands.',
        mode: 'primary',
        prompt: `${runtimeInstructions}\n\nPlan mode: read, discuss, and show proposed text in chat. Selected crew members may return text. Do not write files or run commands.`,
        permission: {
          '*': 'deny',
          read: 'allow', glob: 'allow', grep: 'allow', list: 'allow',
          webfetch: 'ask', websearch: 'allow', external_directory: 'ask', question: 'allow',
          stashbase_list_projects: 'allow', stashbase_list_directory: 'allow',
          stashbase_read_file: 'allow', stashbase_search_project: 'allow',
          // A tool only returns text, which Plan shows in chat.
          ...toolPermissions,
        } as typeof permission,
      },
    },
    permission,
  };
}

function openCodeConfig(
  model: { apiKey: string; baseUrl: string; model: string },
  mcpEnvironment: Record<string, string>,
  persona: string | undefined,
  profiles: readonly HostedAgentProfile[],
  directory: string,
  tools: readonly EnabledAgentTool[],
): Config {
  return buildOpenCodeConfig(model, ensureMcpLauncher(), mcpEnvironment, persona, profiles, directory, tools);
}

class OpenCodeRuntime {
  private running: RunningOpenCode | null = null;
  private starting: Promise<RunningOpenCode> | null = null;
  private startingProcess: RunningOpenCode['process'] | null = null;
  private closing: Promise<void> | null = null;
  private generation = 0;
  private readonly exitListeners = new Set<(error: Error) => void>();

  constructor(
    private readonly mcpEnvironment: Record<string, string> = {},
    private readonly persona?: string,
    private readonly requireAccount = true,
    private readonly agentSessionId = 'history',
    private readonly profiles: () => readonly HostedAgentProfile[] = () => [],
    private readonly tools: () => readonly EnabledAgentTool[] = () => [],
  ) {
    runtimes.add(this);
  }

  availability(): Omit<AgentRuntimeDescriptor, 'id' | 'label' | 'vendor' | 'endpoint' | 'capabilities'> {
    const executable = bundledOpenCodeExecutable();
    if (!executable) {
      return {
        installHint: '',
        launchCommand: 'Bundled with StashBase',
        installed: false,
        source: 'bundled',
        state: 'failed',
        bootstrap: {
          phase: 'failed',
          failure: {
            stage: 'installation',
            code: 'runtime-unavailable',
            message: 'The bundled OpenCode runtime is missing. Reinstall StashBase to repair it.',
            retryable: false,
          },
        },
        error: 'The bundled OpenCode runtime is missing.',
      };
    }
    if (!getHostedAccountSession()) {
      return {
        installHint: '',
        launchCommand: 'Bundled with StashBase',
        installed: true,
        source: 'bundled',
        state: 'failed',
        bootstrap: {
          phase: 'failed',
          failure: {
            stage: 'authentication',
            code: 'account-required',
            message: 'Sign in to StashBase to use the Default Agent and its free credits.',
            retryable: true,
          },
        },
        error: 'Sign in to StashBase to use the Default Agent.',
      };
    }
    return {
      installHint: '',
      launchCommand: 'Bundled with StashBase',
      installed: true,
      source: 'bundled',
      state: 'available',
      bootstrap: { phase: 'ready', progress: 1, message: 'The Default Agent is ready.' },
    };
  }

  async client(directory: string): Promise<OpencodeClient> {
    const running = await this.start(directory);
    return createOpencodeClient({
      baseUrl: running.url,
      directory,
      headers: { authorization: running.authorization },
      throwOnError: true,
    });
  }

  onExit(listener: (error: Error) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  close(): Promise<void> {
    return this.closing ??= this.retire();
  }

  private async retire(): Promise<void> {
    this.generation += 1;
    const running = this.running;
    const process = running?.process ?? this.startingProcess;
    this.running = null;
    this.startingProcess = null;
    releaseHostedAgentChannel(this.agentSessionId);
    if (process) {
      process.kill('SIGTERM');
      const timeout = setTimeout(() => {
        if (process.exitCode == null && process.signalCode == null) process.kill('SIGKILL');
      }, 1_500);
      timeout.unref?.();
      await new Promise<void>((resolve) => {
        if (process.exitCode != null || process.signalCode != null) resolve();
        else process.once('exit', () => resolve());
      });
      clearTimeout(timeout);
    }
    runtimes.delete(this);
  }

  private async start(directory: string): Promise<RunningOpenCode> {
    if (this.closing) throw new Error('OpenCode startup was cancelled.');
    runtimes.add(this);
    if (this.running && this.running.process.exitCode == null) return this.running;
    if (this.starting) return this.starting;
    const generation = this.generation;
    this.starting = this.spawn(generation, directory).finally(() => { this.starting = null; });
    return this.starting;
  }

  private async spawn(generation: number, directory: string): Promise<RunningOpenCode> {
    const executable = bundledOpenCodeExecutable();
    if (!executable) throw new Error('The bundled OpenCode runtime is missing.');
    if (this.requireAccount && !getHostedAccountSession()) {
      throw new Error('Sign in to StashBase to use the Default Agent.');
    }
    await startHostedAgentBroker();
    if (generation !== this.generation) throw new Error('OpenCode startup was cancelled.');
    const port = await availablePort();
    if (generation !== this.generation) throw new Error('OpenCode startup was cancelled.');
    const username = 'stashbase';
    const password = cryptoRandomSecret();
    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    const model = hostedAgentRuntime(this.agentSessionId);
    if (!model) throw new Error('The Agent model broker is not running.');
    const child = spawn(executable, [
      'serve',
      '--hostname=127.0.0.1',
      `--port=${port}`,
      '--pure',
      '--log-level=WARN',
    ], {
      env: openCodeRuntimeEnvironment(openCodeConfig(model, this.mcpEnvironment, this.persona, this.profiles(), directory, this.tools()), username, password),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const exitDiagnostic = agentProcessExitDiagnostic(child);
    this.startingProcess = child;

    try {
      const url = await waitForOpenCodeServer(child, port, exitDiagnostic);
      if (generation !== this.generation) throw new Error('OpenCode startup was cancelled.');
      this.startingProcess = null;
      const running = { process: child, url, authorization };
      this.running = running;
      child.once('exit', (code, signal) => {
        if (this.running?.process !== child) return;
        this.running = null;
        const reason = code ?? signal ?? 'unknown';
        const error = exitDiagnostic(`The included Agent runtime exited unexpectedly (${reason}).`, code, signal);
        log.warn(error.message);
        for (const listener of this.exitListeners) listener(error);
      });
      return running;
    } catch (error) {
      if (this.startingProcess === child) this.startingProcess = null;
      child.kill('SIGKILL');
      throw error;
    }
  }
}

function cryptoRandomSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function waitForOpenCodeServer(
  child: ChildProcessByStdio<null, Readable, Readable>,
  expectedPort: number,
  exitDiagnostic: ReturnType<typeof agentProcessExitDiagnostic>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const finish = (error?: Error, url?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(url!);
    };
    const inspect = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-16_384);
      const match = output.match(/opencode server listening on (https?:\/\/[^\s]+)/);
      if (!match) return;
      const url = new URL(match[1]);
      if (url.hostname !== '127.0.0.1' || Number(url.port) !== expectedPort) {
        finish(new Error('OpenCode bound an unexpected address.'));
        return;
      }
      finish(undefined, url.toString().replace(/\/$/, ''));
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('error', (error) => finish(error));
    child.once('exit', (code, signal) => finish(exitDiagnostic(
      `OpenCode exited during startup (${code ?? signal ?? 'unknown'}). ${output.trim()}`, code, signal,
    )));
    const timeout = setTimeout(() => {
      finish(new Error(`OpenCode did not start within ${START_TIMEOUT_MS}ms. ${output.trim()}`));
    }, START_TIMEOUT_MS);
  });
}

const runtimes = new Set<OpenCodeRuntime>();
// History is local OpenCode state and remains readable while signed out. The
// loopback model broker is configured so the pinned server can start, but it
// cannot reach the hosted gateway without a later authenticated model call.
const historyRuntime = new OpenCodeRuntime({}, undefined, false);

export interface OpenCodeSessionRuntime {
  /** A prewarmed process already has its own private MCP/broker identity. */
  readonly attributionId?: string;
  /** The hosted model profiles this session offers. Read once, before the
   * first `client`, whose runtime is then configured with the same list. */
  models(): Promise<readonly HostedAgentProfile[]>;
  client(directory: string): Promise<OpencodeClient>;
  beginTurn(turnId: string, model?: HostedAgentTurnModel): void;
  /** The tools enabled when the runtime was configured. */
  tools(): readonly EnabledAgentTool[];
  /** One call on the main Agent's own profile inside the running turn (the
   * Auto permission review); answers its text. */
  complete(
    model: HostedAgentTurnModel,
    messages: ReadonlyArray<{ role: 'system' | 'user'; content: string }>,
    signal?: AbortSignal,
  ): Promise<string>;
  /** One tool call inside the running turn, on the turn's catalog snapshot;
   * answers its text, the tool's name, and the model that ran it. */
  runTool(id: string, task: string | (() => Promise<string>), signal?: AbortSignal): Promise<AgentToolResult>;
  endTurn(): void;
  diagnostic?(): unknown;
  onExit(listener: (error: Error) => void): () => void;
  close(): Promise<void>;
}

export type { AgentToolResult } from './default-agent-tools.ts';

interface OpenCodeContext {
  windowId: string;
  directory: string;
  /** The library persona this Chat runs under. */
  persona: string | undefined;
  crew?: string;
}

interface PreparedOpenCode {
  key: string;
  windowId: string;
  directory: string;
  attributionId: string;
  profiles: readonly HostedAgentProfile[];
  tools: readonly EnabledAgentTool[];
  runtime: OpenCodeRuntime;
  ready: Promise<void>;
  close(): Promise<void>;
}

const warmSlot = new OpenCodeWarmSlot<PreparedOpenCode>();

function startupKey(context: OpenCodeContext, persona: string | undefined): string {
  return JSON.stringify([
    context.windowId, context.directory, persona, getHostedAccountSession()?.userId,
    // Instruction contents are read natively at prompt time. Its selected
    // path is process configuration and must still be the project's first.
    ['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md'].find((name) => fs.existsSync(path.join(context.directory, name))),
  ]);
}

/** Each chat owns a server and a private MCP/broker identity. A spare has
 * never run a session or a model request; only that unused server can move
 * to the next chat. Read the catalog afresh before accepting its config. */
export function createOpenCodeSessionRuntime(context: OpenCodeContext): OpenCodeSessionRuntime {
  const persona = resolveAgentPersona(context.persona);
  const choices = context.crew ? crewChatChoices(context.crew) : undefined;
  const key = startupKey(context, persona);
  const prepared = warmSlot.take(key);
  const attributionId = prepared?.attributionId ?? crypto.randomUUID();
  let profiles: readonly HostedAgentProfile[] = [];
  let tools: readonly EnabledAgentTool[] = [];
  let catalog: ToolCatalog | null = null;
  let turn: TurnToolSnapshot | null = null;
  let turnAbort = new AbortController();
  let reading: Promise<readonly HostedAgentProfile[]> | null = null;
  let closed = false;
  const listeners = new Set<(error: Error) => void>();
  const makeRuntime = () => new OpenCodeRuntime({
    STASHBASE_WINDOW_ID: context.windowId,
    STASHBASE_AGENT_SESSION_ID: attributionId,
  }, persona, true, attributionId, () => profiles, () => tools);
  let sessionRuntime = prepared?.runtime ?? makeRuntime();
  const relayExit = (error: Error) => { for (const listener of listeners) listener(error); };
  let stopExitListener = () => {};

  const models = () => reading ??= (async () => {
    const started = performance.now();
    let list: readonly HostedAgentProfile[] = [];
    let toolCatalog: ToolCatalog | null = null;
    // The two catalogs are independent: the main Agent's profiles and the
    // tools' own model pool. Without a tool catalog the chat runs without
    // tools rather than on a guessed configuration.
    await Promise.all([
      fetchHostedAgentProfiles().then((read) => { list = read; })
        .catch((error: unknown) => { log.warn('could not read the Agent model list', error); }),
      latestToolCatalog().then((read) => { toolCatalog = read; })
        .catch((error: unknown) => { log.warn('could not read the tool catalog', error); }),
    ]);
    const catalogMs = Math.round(performance.now() - started);
    profiles = list;
    catalog = toolCatalog;
    if (!toolCatalog && Object.values(choices ?? {}).some((choice) => choice?.enabled)) {
      throw new Error('Your selected crew could not be loaded. Retry the connection or turn those members off.');
    }
    if (toolCatalog) {
      const unavailable = defaultAgentToolViews(toolCatalog, choices)
        .filter((view) => view.enabled && (view.unavailable || view.modelProblem));
      const missing = Object.entries(choices ?? {}).find(([id, choice]) => choice?.enabled && !toolCatalog!.tools.some((tool) => tool.id === id));
      if (unavailable.length || missing) throw new Error(`Your selected crew cannot run: ${unavailable.map((view) => `${view.label}: ${view.unavailable ?? view.modelProblem}`).join('; ') || missing?.[0]}. Update Crew before sending again.`);
    }
    tools = toolCatalog ? enabledAgentTools(toolCatalog, choices) : [];
    if (closed) throw new Error('OpenCode startup was cancelled.');
    if (prepared && (!isDeepStrictEqual(list, prepared.profiles)
      || !isDeepStrictEqual(tools, prepared.tools))) {
      stopExitListener();
      await sessionRuntime.close();
      if (closed) throw new Error('OpenCode startup was cancelled.');
      sessionRuntime = makeRuntime();
    } else if (prepared) {
      // A failed spare is disposable: the explicit connection can retry cold.
      await prepared.ready;
    }
    log.debug('startup preparation', { session_id: attributionId, catalog_ms: catalogMs,
      elapsed_ms: Math.round(performance.now() - started), prewarmed: sessionRuntime === prepared?.runtime });
    return list;
  })();

  function warmNext(): void {
    if (closed || !getHostedAccountSession() || warmSlot.refresh(key)) return;
    const nextId = crypto.randomUUID();
    const nextRuntime = new OpenCodeRuntime({
      STASHBASE_WINDOW_ID: context.windowId, STASHBASE_AGENT_SESSION_ID: nextId,
    }, persona, true, nextId, () => profiles, () => tools);
    const next: PreparedOpenCode = {
      key, windowId: context.windowId, directory: context.directory,
      attributionId: nextId, profiles, tools, runtime: nextRuntime,
      ready: Promise.resolve(), close: () => nextRuntime.close(),
    };
    warmSlot.put(next);
    nextRuntime.onExit(() => warmSlot.discard(next));
    const started = performance.now();
    next.ready = nextRuntime.client(context.directory)
      .then(async (client) => {
        await client.mcp.status({ throwOnError: true });
        log.debug('spare ready', { session_id: nextId, elapsed_ms: Math.round(performance.now() - started) });
      })
      .catch((error: unknown) => {
        log.debug('spare startup failed', error);
        warmSlot.discard(next);
      });
  }

  return {
    attributionId,
    models,
    client: async (directory) => {
      if (!filesystemPath.equal(directory, context.directory)) throw new Error('The OpenCode runtime belongs to another project.');
      await models();
      if (closed) throw new Error('OpenCode startup was cancelled.');
      const started = performance.now();
      const client = await sessionRuntime.client(directory);
      if (closed) throw new Error('OpenCode startup was cancelled.');
      stopExitListener();
      stopExitListener = sessionRuntime.onExit(relayExit);
      log.debug('startup native connection', { session_id: attributionId, elapsed_ms: Math.round(performance.now() - started) });
      return client;
    },
    beginTurn: (turnId, model) => {
      turnAbort.abort();
      turnAbort = new AbortController();
      beginHostedAgentTurn(attributionId, turnId, model);
      turn = { catalog, tools: [...tools], bound: false };
    },
    tools: () => tools,
    complete: (model, messages, signal) => completeHostedAgentModel(attributionId, model, messages, signal),
    runTool: async (id, task, signal) => {
      const snapshot = turn;
      const lifetime = AbortSignal.any([turnAbort.signal, ...(signal ? [signal] : [])]);
      lifetime.throwIfAborted();
      if (!snapshot) throw new Error('Crew members work only inside an Agent turn.');
      const brief = typeof task === 'string' ? task : await task();
      lifetime.throwIfAborted();
      return runToolInTurn(snapshot, id, (on) => {
        lifetime.throwIfAborted();
        return completeHostedAgentTool(attributionId, agentToolSelection(on), [
          { role: 'system', content: agentToolPrompt(on.tool) },
          { role: 'user', content: brief },
        ], lifetime);
      }, latestToolCatalog,
      (error) => error instanceof HostedAgentToolError && error.code === 'agent_tool_version_changed', lifetime);
    },
    endTurn: () => {
      turnAbort.abort();
      turn = null;
      endHostedAgentTurn(attributionId);
      // Avoid competing with the first reply. Disposal closes the owner in
      // this same stack, so its queued warm-up sees `closed` and does nothing.
      queueMicrotask(warmNext);
    },
    diagnostic: () => hostedAgentDiagnostic(attributionId),
    onExit: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close: () => { closed = true; turnAbort.abort(); stopExitListener(); return sessionRuntime.close(); },
  };
}

export const discardWarmOpenCodeForWindow = (windowId?: string): Promise<void> =>
  warmSlot.clear((entry) => !windowId || entry.windowId === windowId);
export const discardWarmOpenCodeForFolder = (directory: string): Promise<void> =>
  warmSlot.clear((entry) => filesystemPath.equal(entry.directory, directory));

export const openCodeClient = (directory: string): Promise<OpencodeClient> => historyRuntime.client(directory);
export const openCodeRuntimeAvailability = () => historyRuntime.availability();
export async function stopOpenCodeRuntime(): Promise<void> {
  await warmSlot.clear();
  await Promise.all([...runtimes].map((runtime) => runtime.close()));
  await stopHostedAgentBroker();
}
