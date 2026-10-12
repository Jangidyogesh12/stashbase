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

Schema version 4 carries an event UUID, occurrence time, app version, OS,
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
| `agent_turn_finished` | Submission completes, fails, is blocked or cancelled | `runtime`, `turn_id`, `outcome`, duration bucket |
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

Runtime values are stashbase, claude and codex. Outcomes are success, failed,
cancelled or blocked; saves use conflict. Durations are under 10 seconds,
10–60 seconds, 1–5 minutes, or over 5 minutes. Diagnostic context can include
model/runtime version, native session/connection ID, method and route, target
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

An identical diagnostic is reported when first seen. Repeats within its window
(one minute for errors, ten minutes for warnings) are counted locally and sent as
one event when the window closes. `occurrences` is the number of times it happened
since the previous report of that diagnostic, including this one, so summing it
over time gives the real frequency. A failure that persists produces one event
per window; an isolated one produces a single event with `occurrences = 1`.
Counts not yet sent at shutdown join the delivery queue. Older builds omit
`occurrences` and reported warnings as `application_error`.

Save, project-open and billing operations retain their initiating identity across
an asynchronous account switch. A turn's random correlation ID retains its
initiating identity and session until its one terminal result in the same host
process. A terminal result with no retained start is not inferred after a host
restart or opt-out. Error context may include the native session ID and file paths
needed for diagnosis; turn events themselves contain no conversation content.

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
120 events per minute. A full queue refuses new events rather than evicting an
identity link and silently accepting its dependent events.

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
