import path from 'node:path';

/**
 * How StashBase starts an Agent CLI.
 *
 * Windows runs a `.cmd` or `.bat` launcher, such as the shim npm installs for
 * `codex` or `claude`, only through cmd.exe. Node's `shell: true` joins the
 * path and arguments without quoting, so a profile path with a space
 * (`C:\Users\Jane Doe\AppData\Roaming\npm\codex.cmd`) is cut at the space and
 * the CLI never starts. The command line is built here with cmd's own escapes
 * instead, following cross-spawn. Every other executable starts directly.
 */
export interface AgentCliLaunch {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

// Characters cmd.exe interprets outside quotes; a caret makes each literal.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function cmdArgument(arg: string): string {
  // Argument-vector quoting: backslashes before a quote, or before the
  // closing quote, are doubled.
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  // Escaped twice: once for this command line, and once more because the
  // launcher hands its own arguments (`%*`) to cmd.exe again.
  return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

export function agentCliLaunch(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  comspec: string = process.env.ComSpec || 'cmd.exe',
): AgentCliLaunch {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) return { command, args: [...args] };
  const line = [path.win32.normalize(command).replace(CMD_META, '^$1'), ...args.map(cmdArgument)].join(' ');
  return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}
