/**
 * Settings → MCP: what an external client needs to reach this project, and the
 * two ways it can reach it. StashBase never writes another client's
 * configuration, so every row here is something to read or copy, beside the
 * three writes that change how the listener is reached.
 *
 * The Docker listener is drawn off the one `McpDockerState` the domain
 * resolves rather than off the opt-in and the live listener separately, so
 * "asked for, not up yet" and "up although the opt-in never saved" each get
 * their own word instead of colliding on one boolean.
 */

import { Check, Copy } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { InputField, InputGroup } from '@/components/ui/input-group';
import { Switch } from '@/components/ui/switch';
import { TabsSubtle, TabsSubtleItem } from '@/components/ui/tabs-subtle';
import type { McpAccessPort } from '@/features/settings/application/ports';
import {
  isMcpDockerPort,
  MCP_DOCKER_PORT_RANGE,
  type McpDockerState,
} from '@/features/settings/domain/mcp-access';
import { useMcpAccess } from '@/features/settings/hooks/use-mcp-access';
import {
  Disclosure,
  SettingsGroup,
  SettingsList,
  SettingsMessage,
  SettingsPane,
  SettingsRow,
  StatusChip,
} from '@/features/settings/ui/rows';
import { FailureNotice } from '@/shared/ui/failure-notice';

export interface McpAccessPanelProps {
  mcpAccessApi: McpAccessPort;
}

const PORT_ERROR = `Enter a port from ${MCP_DOCKER_PORT_RANGE.min} to ${MCP_DOCKER_PORT_RANGE.max}.`;

/** The pane keeps its title and lede while the read is in flight or has
 *  failed, so the section never collapses into a bare sentence. */
const TITLE = 'External apps (MCP)';
const LEDE = 'Let other AI apps search, read, and edit files in your projects.';

/** Fixed width rather than one dot per character: the row must not change
 *  shape when a rotation lands, and a mask that counts out the credential is
 *  telling the room something about it. */
const TOKEN_MASK = '••••••••••••••••';

/** A value the reader copies verbatim, so it is set in the monospace face and
 *  allowed to break anywhere rather than pushing the row wide. */
function Mono({ children }: { children: string }) {
  return <span className="font-mono break-all">{children}</span>;
}

function CopyButton({
  copied,
  disabled = false,
  label,
  onCopy,
}: {
  copied: boolean;
  disabled?: boolean;
  label: string;
  onCopy: () => void;
}) {
  return (
    <>
      <Button
        aria-label={copied ? 'Copied' : `Copy ${label}`}
        disabled={disabled}
        onClick={onCopy}
        size="icon-compact"
        variant="ghost"
      >
        {copied ? <Check /> : <Copy />}
      </Button>
      {/* The icon and name flip alone is silent: a name change on a control
          that already holds focus is not re-announced. This region is empty at
          rest and speaks the moment the copy lands. */}
      <span className="sr-only" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </>
  );
}

/** Keyed by the saved port, so a server-side change replaces the draft
 *  instead of an effect having to reconcile it. */
function DockerPortForm({
  disabled,
  onSave,
  port,
}: {
  disabled: boolean;
  onSave: (port: number) => void;
  port: number;
}) {
  const [draft, setDraft] = useState(String(port));
  const parsed = Number(draft);
  const invalid = draft !== '' && !isMcpDockerPort(parsed);
  const refused = disabled || invalid || draft === '' || parsed === port;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (refused) return;
    onSave(parsed);
  };
  return (
    <form className="flex items-start gap-1.5" onSubmit={submit}>
      <InputGroup className="w-40" size="compact">
        <InputField
          disabled={disabled}
          error={invalid ? PORT_ERROR : undefined}
          inputMode="numeric"
          label="Docker port"
          labelHidden
          max={MCP_DOCKER_PORT_RANGE.max}
          min={MCP_DOCKER_PORT_RANGE.min}
          onChange={setDraft}
          resting="filled"
          type="number"
          value={draft}
        />
      </InputGroup>
      <Button disabled={refused} size="compact" type="submit" variant="tertiary">
        Save port
      </Button>
    </form>
  );
}

/** The listener row, resolved from the one state word rather than from a
 *  chain of checks against the opt-in and the live listener. The chip carries
 *  the state; the sentence beside it only says what happened. */
function dockerListener(
  state: McpDockerState,
  error: string | null,
): { chip: ReactNode; detail: ReactNode } | null {
  switch (state) {
    case 'active':
      return { chip: <StatusChip>Listening</StatusChip>, detail: null };
    case 'starting':
      return { chip: <StatusChip tone="muted">Starting…</StatusChip>, detail: null };
    case 'failed':
      return { chip: <StatusChip tone="warn">Not listening</StatusChip>, detail: error };
    case 'off':
      return null;
  }
}

export function McpAccessPanel({ mcpAccessApi }: McpAccessPanelProps) {
  const mcp = useMcpAccess(mcpAccessApi);
  const [connection, setConnection] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const access = mcp.access;

  if (mcp.loading || !access) {
    return (
      <SettingsPane lede={LEDE} title={TITLE}>
        <SettingsList>
          {mcp.loading ? (
            <SettingsMessage message="Loading MCP settings…" />
          ) : (
            <SettingsMessage message="Could not load MCP settings." onRetry={() => mcp.reload()} />
          )}
        </SettingsList>
      </SettingsPane>
    );
  }

  const http = access.http;
  const unreadable = http.settingsError !== null;
  const listener = dockerListener(mcp.dockerState, http.dockerError);

  return (
    <SettingsPane lede={LEDE} title={TITLE}>
      <TabsSubtle
        aria-label="Connection method"
        selectedIndex={connection}
        onSelect={(index) => {
          setConnection(index);
          setRevealed(false);
        }}
        size="compact"
      >
        <TabsSubtleItem label="Command" />
        <TabsSubtleItem label="URL" />
      </TabsSubtle>
      {connection === 0 ? (
        <SettingsGroup hint="Copy this JSON into your client's MCP settings, then restart the client.">
          <SettingsList>
            <SettingsRow
              title="JSON configuration"
              trail={
                <CopyButton
                  copied={mcp.copied === 'config'}
                  label="configuration"
                  onCopy={() => mcp.copy('config')}
                />
              }
            >
              <pre className="m-0 max-h-80 overflow-auto font-mono text-caption leading-snug wrap-anywhere whitespace-pre-wrap text-foreground">
                {access.config}
              </pre>
            </SettingsRow>
          </SettingsList>
        </SettingsGroup>
      ) : (
        <>
          <SettingsGroup
            hint="Use the local URL and bearer token for clients that connect over HTTP."
            title="Local access"
          >
            <SettingsList>
              {http.settingsError !== null && (
                <SettingsRow
                  detail={http.settingsError}
                  role="status"
                  title="MCP settings are unavailable"
                  titleTone="muted"
                />
              )}
              <SettingsRow
                detail={<Mono>{http.loopbackUrl}</Mono>}
                title="Local URL"
                trail={
                  <CopyButton
                    copied={mcp.copied === 'loopback'}
                    label="local URL"
                    onCopy={() => mcp.copy('loopback')}
                  />
                }
              />
              <SettingsRow
                detail={
                  http.token === null ? (
                    'Could not read the saved token.'
                  ) : (
                    <Mono>{revealed ? http.token : TOKEN_MASK}</Mono>
                  )
                }
                title="Bearer token"
                trail={
                  <>
                    <Button
                      aria-label={revealed ? 'Hide token' : 'Show token'}
                      disabled={http.token === null}
                      onClick={() => setRevealed(!revealed)}
                      size="compact"
                      variant="ghost"
                    >
                      {revealed ? 'Hide' : 'Show'}
                    </Button>
                    <CopyButton
                      copied={mcp.copied === 'token'}
                      disabled={http.token === null}
                      label="token"
                      onCopy={() => mcp.copy('token')}
                    />
                    <Button
                      disabled={http.token === null}
                      onClick={() => setConfirming(true)}
                      size="compact"
                      variant="tertiary"
                    >
                      Rotate token…
                    </Button>
                  </>
                }
              />
            </SettingsList>
          </SettingsGroup>

          <SettingsGroup
            hint="Opens a network port that requires the bearer token. Other StashBase APIs stay local."
            title="Docker access"
          >
            <SettingsList>
              <SettingsRow
                detail="Lets containers on this computer connect to MCP."
                title="Allow containers"
                trail={
                  <Switch
                    checked={http.dockerAccess}
                    disabled={mcp.busy || unreadable}
                    label="Allow containers"
                    labelHidden
                    onToggle={() => mcp.setDockerAccess(!http.dockerAccess)}
                  />
                }
              />
              {listener && (
                <>
                  <SettingsRow
                    detail={<Mono>{http.dockerUrl}</Mono>}
                    title="Docker URL"
                    trail={
                      <CopyButton
                        copied={mcp.copied === 'docker'}
                        label="Docker URL"
                        onCopy={() => mcp.copy('docker')}
                      />
                    }
                  />
                  <SettingsRow
                    detail={listener.detail}
                    role="status"
                    title="Listener"
                    trail={listener.chip}
                  />
                </>
              )}
            </SettingsList>
            <Disclosure summary="Docker port settings">
              <SettingsRow
                detail={
                  http.dockerAccess
                    ? 'Turn Docker access off to change the port.'
                    : 'Port used when Docker access is enabled.'
                }
                title="Port"
                trail={
                  <DockerPortForm
                    disabled={mcp.busy || http.dockerAccess || unreadable}
                    key={http.dockerPort}
                    onSave={(port) => mcp.setDockerPort(port)}
                    port={http.dockerPort}
                  />
                }
              />
            </Disclosure>
            <Disclosure summary="Native Linux Docker Engine">
              <p className="text-caption text-muted-foreground">
                On Linux, add <Mono>host.docker.internal</Mono> using{' '}
                <Mono>--add-host=host.docker.internal:host-gateway</Mono> or a Compose{' '}
                <Mono>extra_hosts</Mono> entry.
              </p>
            </Disclosure>
          </SettingsGroup>
        </>
      )}

      <ConfirmDialog
        confirmLabel="Rotate token"
        description="The current token will stop working immediately. Update connected clients with the new token."
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => mcp.rotateToken(() => setConfirming(false))}
        open={confirming}
        pending={mcp.rotating}
        title="Rotate MCP token?"
      />

      {mcp.failure && <FailureNotice failure={mcp.failure} />}
    </SettingsPane>
  );
}
