# Usage statistics

Official desktop builds send product activity and detailed error diagnostics to
PostHog by default. **Settings → General → Privacy → Share usage statistics**
controls both. All features remain available when collection is off. Development
builds and builds without a destination do not send. Website activity is outside
this desktop collection.

## Identity and sign-in

The desktop creates a random installation ID and a separate anonymous ID. Neither
comes from hardware. Both survive launches. When you sign in, the host links the
current anonymous history to your stable StashBase account ID. Signing in to that
account on another installation links its activity to the same person, while the
installation property keeps their origins distinguishable. Identity linking uses the account ID, not profile email, name or avatar.
Diagnostic prose can include names or paths mentioned by a failing operation;
known credential patterns are filtered.

Signing out or changing accounts creates a new anonymous identity. An installation
is a property, never an alias used to merge all accounts on that computer.
Anonymous activity is attributed to the next verified sign-in in that anonymous
period; this is an attribution convention, not proof that a shared computer had
only one human operator. Unidentified installations cannot be reliably combined
into a person. Reinstalling or clearing application settings can create a new
installation identity.

## Events and interpretation

Schema version 5 carries an event UUID, occurrence time, app version, OS,
installation ID, anonymous ID, installation first-observed time, and, when signed
in, the account ID. Active work also establishes a session ID shared across
windows; 30 minutes without reported activity starts another session. The first
observed time means entry into this measurement, not a proven download/install
date. Older builds do not supply the same activity or identity evidence.

| Event | Meaning | Additional fields |
|---|---|---|
| `app_opened` | Workspace mounts, once per host lifetime | None |
| `app_active` | Trusted pointer, keyboard or wheel input in a visible, focused app window | `mode`: welcome / documents / chat |
| `document_engaged` | Interaction inside the active document surface, or an actual editor change | `activity`: read / edit; allowlisted `format` |
| `project_entry_result` | Host project-open operation settles | `outcome` |
| `agent_turn_started` | User submission or manual retry begins preparation | `runtime`, random `turn_id` |
| `agent_turn_stage` | Host observes a significant execution boundary | `runtime`, `turn_id`, `stage`, per-turn `sequence`, bounded correlation context |
| `agent_turn_finished` | Submission completes, fails, is blocked, cancelled or interrupted | `runtime`, `turn_id`, `outcome`, `source`, optional `reason`, last stage, sequence and observation times; duration only for an observed end |
| `document_write_result` | Versioned editor save settles | `outcome`; success includes `changed` |
| `account_login_started` | A browser sign-in flow starts | None |
| `account_login_result` | Sign-in completes or fails | `outcome` |
| `account_signed_out` | Local account is signed out | None |
| `$identify` | Verified account links its preceding anonymous identity | `$anon_distinct_id` |
| `billing_checkout_result` | Host obtains a verified Checkout page or fails | `outcome` |
| `billing_portal_result` | Host obtains a verified management page or fails | `outcome` |
| `subscription_observed` | Hosted API confirms subscription rights; unchanged polling is suppressed | bounded `plan`, `paid`, `cancel_at_period_end` |
| `agent_setup_result` | Agent setup settles or connection fails | `runtime`, `stage`, `outcome`, optional failure stage and diagnostic |
| `agent_setup_stage` | Discovery, installation, authentication or MCP stage starts or succeeds | `runtime`, `attempt_id`, `stage`, `outcome` |
| `application_error` | Host, renderer, Agent or native failure | `source`, `operation`, optional `runtime`, detailed `diagnostic`, `occurrences` |
| `application_warning` | Operation degraded but continued, such as a saved file that could not be indexed, a refused (4xx) request, or an Agent that is not ready | Same as `application_error` |

`app_active` and each document activity/format category are limited to once per UTC
minute across windows. They are not heartbeats. Idle background processes,
restored tabs, automatic source refresh, and streamed Agent output alone do not
create active days. Read engagement is a surface-interaction proxy: it cannot
prove comprehension, and silent reading without interaction is not counted.
Editing events contain no text or keystrokes. Unchanged saves report
`changed: false`; changed saves and completed turns are measurable results, not
proof of writing quality or user satisfaction. Agent file writes are not inferred
from generated replies. Project entry excludes picker cancellations and acquisitions
that never reach the open operation.

Runtime values are stashbase, claude, codex and antigravity. Outcomes are success, failed,
cancelled or blocked; saves use conflict. Agent turns additionally use interrupted when execution continuity was lost without a confirmed result. Durations are under 10 seconds,
10–60 seconds, 1–5 minutes, or over 5 minutes. Diagnostic context can include
model/runtime version, native session/connection ID, WebSocket close code/clean flag, tool call ID/category, model call ID/attempt, method and route, target
update version, setup stage, exact elapsed milliseconds and request/turn IDs.
Setup attempts have unique IDs and retries point to the preceding failed attempt.
An installation success followed by authentication failure means the executable
was installed and verified but is not signed in.

Diagnostics preserve original messages, error names and codes, HTTP/exit status,
provider request IDs, causes, stack traces, React component stacks and bounded
process stdout/stderr and error response bodies. They preserve paths and explanations instead of replacing
them with generic summaries. Messages/output are bounded to 8,000 characters,
stacks to 16,000, and causes to four; truncation preserves the beginning and end
and is marked. Each serialized diagnostic also has a 128 KB byte ceiling. Arbitrary provider objects are never serialized. Bearer/basic
credentials, credential assignments, common API keys, private keys, URL passwords
and cookies are filtered at capture and again before sending. This is targeted
filtering, not a promise to remove every personal detail from diagnostic prose.

HTTP response diagnostics include the status even when a 2xx response cannot
be decoded, its content type, the host-issued request ID, and the original
parsing/read cause. Requested cancellation is excluded. Default Agent failures
can include the native message ID, finish reason and token counts, plus the
current gateway request ID, retry attempt, byte/frame counts, stream-end and
DONE markers, finish reasons and explicit provider/transport errors. Stream
observation retains protocol metadata only, not replies, tool arguments or
prompts. Missing provider explanations remain missing; request IDs support
follow-up investigation rather than implying a known root cause.

Allowance-query failures keep the local response status separate from the
upstream status/request ID or original network cause. Daemon and Agent startup
exit diagnostics retain a bounded stderr tail and available exit code/signal.
An Agent error immediately followed by an exit with the same explanation is
one diagnostic with the original cause; both notifications still reach the UI.

An identical diagnostic is reported when first seen. Repeats within its window
(one minute for errors, ten minutes for warnings) are counted locally and sent as
one event when the window closes. `occurrences` is the number of times it happened
since the previous report of that diagnostic, including this one, so summing it
over time gives the real frequency. A failure that persists produces one event
per window; an isolated one produces a single event with `occurrences = 1`.
Counts not yet sent at shutdown join the delivery queue. Older builds omit
`occurrences` and reported warnings as `application_error`.

Native update checks classify recognized offline, network-change, suspended-network
and DNS failures as warnings, including known GitHub latest-release error wrappers.
Release XML contents do not determine severity. Their identical diagnostics use a one-hour window,
since periodic checks are fifteen minutes apart. The first warning is immediate;
later reports carry the repeat count. Identity, source version and diagnostic
remain separate aggregation keys. Download/install failures and unexpected check
failures retain error severity. Queued native reports preserve occurrence order,
and shutdown queues pending repeat counts; opt-out erases them.

Save, project-open and billing operations retain their initiating identity across
an asynchronous account switch. Admitted turns persist their initiating identity,
session, app version, start time and last observed stage. Renderer preparation
outcomes and host runtime outcomes converge on one terminal record. Its UUID is
the turn ID; duplicate terminal signals do not create another result. A bounded
recent-completion record also rejects delayed duplicate starts. Unknown terminal
IDs never manufacture a start.

`agent_turn_started` means submission preparation, not native execution.
Stages are `preparing` (the initial record), `host_accepted`, `runtime_dispatched`,
`model_request_started`, `response_started`, `waiting_permission`, and
`tool_running`. Stages can repeat across model/tool calls; sequence numbers order
observations. Response start can mean received model headers or native output,
not a complete or useful answer. Claude/Codex/Antigravity expose native dispatch/output/tool
boundaries; only Default's owned broker exposes individual model requests.
Stage events remain rate/capacity limited, but the pending turn's last stage is
saved even when a stage event cannot be queued. Streamed tokens do not write
telemetry state. The last stage establishes observation, not causation.

At the next healthy host launch, a retained unfinished turn becomes
`interrupted` with `reason: host_restarted` and `source: recovery`. Its actual
result and end time remain unknown: `recovered_at` is the observation time,
`last_observed_at` retains the previous host's evidence, and no `finished_at` or
duration is invented. Observed graceful exits distinguish app shutdown, update,
and other host shutdown. Original identity and app version survive recovery.
Turning collection off erases pending and recent turn records too.

Connection IDs are shared across the socket's endpoints from connection creation;
turn IDs bind accepted prompts and request-scoped context reads. Unrelated HTTP
requests never inherit a foreground chat's ID. A WebSocket 1006 is a lost close
handshake, not a diagnosis of network or process failure. Model failures are
reported at the broker even when the native adapter cannot relay them. Tool
failure facts exclude arguments/results and can coexist with a successful turn.
Error context may include native session IDs and diagnostic paths; turn events
contain no conversation content.

Checkout success means a page was obtained, not that payment succeeded.
`subscription_observed` means confirmed rights, not a new charge: the same account
can be observed on multiple devices or after signing back in. Revenue, invoices,
refunds and a complete purchase ledger require the hosted billing service and are
not measured by desktop events.

## Delivery and turning collection off

The host atomically saves bounded, validated event envelopes in the owner-only
application configuration before sending. The queue holds at most 500 events for
seven days. Network failures, timeouts, rate limiting and service failures retry
with bounded backoff; permanent request refusals are dropped. UUIDs, event times,
identities and app versions stay fixed during retry and across process restarts.
PostHog receives the stable event UUID for deduplication. Admission is limited to
120 ordinary events per minute. Up to 100 admitted pending turns each reserve
one of the 500 queue slots for their terminal record. Terminals consume that
reservation without ordinary rate limiting; queueing the terminal and removing
the pending record are one atomic write. Full queues refuse new starts and other
events rather than evicting identity links or reserved terminals. Pending records
and up to 500 recent-completion IDs expire after seven days. Local storage failure,
expiry and permanent ingestion refusal still limit delivery. Independently
arriving host observations can wait briefly for an in-flight renderer start;
this bounded in-memory race buffer cannot reconstruct starts lost before admission.

Collection never waits on network delivery to complete a writing operation or
shutdown. The host re-reads current configuration after each outbound request so
an acknowledgement cannot overwrite newer preferences or newly queued work.
Renderer delivery queues up to 100 errors and retries each up to three times.
Native processes spool up to 50 bounded errors for seven days, including startup,
renderer/child-process crashes, MCP startup and actual updater failures. The host
imports them every five seconds or on shutdown, retaining occurrence time and
source version. A crash before any host can run is recoverable only after a later
healthy launch; a full spool can lose further errors.

Queue expiry, saturation, unavailable local storage, ingestion rejection and
uninstall can still lose events. HTTP acceptance alone does not establish that a
provider's identity merge or dashboard query has completed.

Turning collection off cancels pending requests and removes the queue, all local
analytics identities, native diagnostic files and suppression markers. There is no final opt-out network
notification. A persistence failure still stops this process and shows failure;
relaunch suppression is guaranteed only once the choice is saved successfully.
Already transmitted events cannot be recalled or deleted by this switch.
Re-enabling starts fresh local IDs and never backfills disabled activity. If still
signed in, new activity is again associated with that account, including its
existing PostHog person history.

## What is never sent

Documents, chat transcripts, prompt/reply payloads, search queries, hardware
fingerprints, screenshots, clipboard contents, full raw logs or content hashes are
not collected as analytics fields. Known credentials are filtered from diagnostic
text. File/project paths, URLs and personal details can occur inside an error
message, stack or bounded process output; these diagnostic details are retained.
There is
no DOM click payload capture, session replay, pageview tracking or AI tracing.
Authenticated activity creates person profiles using the stable account ID;
unidentified events request no profile. IP and GeoIP enrichment are disabled in
payloads. The receiving service still sees the connection IP; operators must
also disable IP retention in PostHog.

## Retention views

Use schema version 3 and later, one fixed UTC calendar, event occurrence time,
and only cohorts whose observation window has elapsed. Keep installation and
person views separate. In person views, use PostHog's resolved person identity
so linked anonymous and authenticated histories count once; do not simply
coalesce each row's user ID with its installation ID. Later identity merges can
change historical cohort membership. Never filter the initial population to
signed-in people only.

Recommended saved views:

- **Observed return retention:** first `app_active` → later `app_active`.
- **Core-use retention:** first `document_engaged` or `agent_turn_started` →
  another event from that same union. Include blocked attempts here, then inspect
  success/failure separately.
- **After first result:** first successful `agent_turn_finished` or successful
  `document_write_result` with `changed = true` → subsequent core use. This
  measures retention after a result, not only among people who log in.
- **Activation funnel:** first active use → successful project entry → core
  attempt → first result. Login is an optional branch, not a universal prerequisite.
- **Account funnel:** login started → login success → subsequent core use.
- **Desktop subscription funnel:** Checkout page obtained → confirmed paid rights.
  Deduplicate by person and label it observed conversion, not payment revenue.

D1, D7 and D30 mean return on exactly that calendar day after cohort entry. W1
means at least one return on days 7–13; W4 means days 28–34. Divide returning
identities by eligible identities in that entry cohort, not all current users.
Use unique installations for installation retention and resolved persons for
person retention. Break down event-time OS, version, mode and Agent runtime;
do not substitute mutable current profile properties for cohort-entry attributes.

These views describe reporting activity, not all users. Missing events can mean
offline use, blocked transport, opt-out, reinstall or abandonment. Do not label
all missing activity as confirmed churn. Historical schema-2 installation counts
are not directly comparable with schema-3 person or foreground retention.

## Turn diagnosis views

For schema 5, join starts, stages, terminal results and diagnostics by `turn_id`,
using `connection_id` for pre-prompt connection failures and request IDs for
specific HTTP/model calls. Inspect sequence and occurrence/observation times,
not ingestion order. Keep the original app version and installation in breakdowns.

Track missing results separately from confirmed failures and recovered unknown
results. A start without `host_accepted` has no evidence of execution; a start
with later stages but no terminal has a different diagnostic scope. A 415 only
belongs to a turn when its originating request carries that turn ID. Tool errors
and recovered request attempts are not themselves terminal turn failures.

Set age thresholds by stage and allow an offline-delivery grace window. Waiting
for permission is user-dependent and must not use a model-response timeout.
These views report missing observed results, never proven hangs, crashes or churn.
Production saved views/alerts and provider receipt require separate operator
verification; local tests use replaced transport.

## Implementation and operator setup

`server/telemetry.ts` owns identity, admission, session attribution, opt-out and
transport. `server/telemetry-state.ts` validates persisted envelopes and maps them
to the Capture API. The event allowlist is
`shared/protocols/http/telemetry.ts`; renderer intake accepts only renderer-owned
facts. Authentication and billing facts cannot be supplied by renderer event
requests. No analytics SDK or remote configuration runs.

`server/telemetry-destination.json` contains the public PostHog ingestion token
and host, never a Personal API key or secret. Forks should clear or replace it.
Disable IP retention in the receiving project and choose its event retention
period independently from the seven-day local delivery limit.

### Testing packaged builds

Node test workers, `NODE_ENV=test`, Vitest and Jest processes automatically disable
production collection and native diagnostic spooling, even if they inherit
`STASHBASE_PACKAGED=1`. The shared host-test fixture also passes
`STASHBASE_TELEMETRY_DISABLED=1` to descendants. Collection unit tests use explicit
fixtures with fake transport; production-admission tests replace transport before import.

For manual packaged checks, set `STASHBASE_TELEMETRY_DISABLED=1` before starting an app/server test process.

It suppresses all collection and queue delivery, including identity links,
without changing saved preferences or analytics state. Settings cannot override
it. Verify `/api/telemetry` reports `available: false` before exercising flows.
Smoke launchers set it themselves. For example:

```bash
env -u ELECTRON_RUN_AS_NODE STASHBASE_TELEMETRY_DISABLED=1 \
  /Applications/StashBase.app/Contents/MacOS/StashBase
```

Windows PowerShell uses `$env:STASHBASE_TELEMETRY_DISABLED = '1'`; Linux sets it
before the AppImage launch. Reapply it for each process, including updater tests.
Use isolated test profiles. Tests of collection replace the transport with a
local sink and never send test events to production PostHog.

Protocol references: [Capture API](https://posthog.com/docs/api/capture),
[identity linking](https://posthog.com/docs/product-analytics/identify),
[anonymous and identified events](https://posthog.com/docs/data/anonymous-vs-identified-events).
