# Account and Settings

## Scope and Access

Settings, first-send access, and external-client setup share current configuration
and recovery rules. Local browsing, editing, preview, and keyword search require
no account.

| Capability | Access source |
|---|---|
| Default Agent | StashBase account with free or subscribed Agent credits |
| Codex / Claude / Antigravity | The native runtime's installation and authentication |
| Search by meaning | User-supplied embedding key in Settings, billed independently |
| External HTTP MCP | Current Settings token; separate opt-in for Docker access |

Selecting an Agent is not login or installation consent. Account sign-in does not
enable search. Credentials remain outside projects, renderer persistence, and
Agent history; supplied environment variables do not configure BYOK access.

## Settings Organization

Settings owns lasting preferences and connection configuration:

- **General:** appearance, updates, and usage statistics, in that order. Appearance is user-wide
  and grouped as:
  - **Theme:** a mode (match system, light, dark) plus a light theme and a dark
    theme chosen separately from published palettes (StashBase, Catppuccin,
    Tokyo Night, Rosé Pine, Gruvbox, Nord). Every theme keeps body and
    secondary text at WCAG AA on its surfaces. The theme also governs native
    menus, dialogs, and the window background from launch.
  - **Interface:** interface size, which reaches all chrome text, and reduce
    motion (match system or on).
  - **Documents:** how document text looks: the document font, chosen from the two included reading fonts
    (Serif, the default, and Sans) or any font installed on the computer; the
    code font, from the bundled monospace or installed monospaced fonts; and
    reading text size, line spacing, and line width. The document's reading
    menu edits the same reading font and size.
  - **Writing:** what helps while writing: spellcheck and its language (where
    the system offers a choice), focus mode, typewriter scrolling, and word
    count.

  Every appearance value is a preset except the two font names, which are
  validated as names before they are stored. An installed writing font
  overrides the Serif/Sans preset and keeps that preset's size steps and
  measure; choosing Serif or Sans again clears it. A chosen font that is later
  uninstalled stays selected, is marked as not installed, and falls back to
  the included default. The installed-font list never leaves the device.
  Custom colors, custom CSS, imported editor themes, and per-project
  appearance are out of scope.
- **Agents:** group account, credit balance/refill, and connection state under
  Default, with the account's subscription and the plans it can buy; manage Codex, Claude, and Antigravity individually. An installed runtime shows its
  version and offers Update when StashBase can select the resulting installation.
  Install and Update both use the provider's official native installer, without
  an installation-method choice. Updating an npm installation selects the
  verified native copy for subsequent sessions and leaves the npm copy intact.
  Explicit executable overrides remain authoritative; an override outside the
  native installation must be removed before updating through StashBase.
  Each native Agent checks its own sign-in status before readiness and offers
  its provider's browser sign-in when needed. Antigravity has no separate
  sign-in command: its sign-in opens the browser from a terminal session
  StashBase starts, a pseudo-terminal on macOS and Linux and a console window on
  Windows, and closes it once Antigravity reports a signed-in account.
  A signed-in account the provider refuses, for example outside its available
  regions, reads as Account not accepted with the provider's own sentence. It
  offers a recheck, not another sign-in. An expired sign-in reported by
  a running conversation restores that action without clearing credentials.
  Setup and update failures show the failed operation, stage, and available
  diagnostic in place, including service refusals and download errors.
  A runtime that reports a model its
  installed version cannot run leads its row with that model instead of its
  readiness; the requirement shown is the runtime's own, never one StashBase
  worked out. Credits refresh automatically; token accounting is not a
  user setting.
- **Advanced:** search by meaning and external apps (MCP). Search links directly
  to its configuration without discarding the current query. MCP reveals HTTP
  credentials only for that connection method; Docker details follow explicit
  configuration. Port changes require Docker access to be off.

PDF/OCR setup is automatic. Waiting documents expose failed-download recovery
through the same shared component owner. Help owns bug reporting; development
simulators use a separate development-only entry. Neither belongs in normal Settings.

## Shared State and Recovery

- Settings declare their scope. Project Agent preferences follow the project;
  current account and embedding configuration are shared across windows.
- A failed read is not an empty configuration. Failed writes preserve unrelated
  settings and report failure; disposable caches cannot overwrite unreadable state.
- Later changes supersede pending validation or authentication. Stale completion
  cannot restore a removed key or signed-out account. Reconfigure only the dependent
  service; report a persisted change separately from a failed runtime restart.
- One browser sign-in wait serves each window's surfaces and survives closing
  Settings. Cancelling the local wait does not revoke browser authorization;
  new attempts and sign-out retire prior local continuations across windows.
- Network/provider failure preserves credentials. Clear a session only on explicit
  sign-out or confirmed invalidation; repair does not implicitly send or replay work.
- A runtime too old for a chosen model is repaired where it failed: the turn
  offers the runtime's update, the conversation reconnects on the updated
  runtime, and the refused request is sent again. Settings offers the same
  update without a conversation. A failed installation or update retries that
  operation; reconnecting an existing copy alone does not count as an update.
  Identical setup requests share progress. A different request during setup is
  explicitly refused with the running operation and retry guidance. Downloads,
  installation, and sign-in have bounded waits; timeout releases their process
  ownership before retry becomes available.
- A persona applies from its Chat's next message; a running turn keeps its
  guidance. It does not rewrite native instruction files or
  change permissions.
- External MCP rotation invalidates the old token. Disable retires exposed access
  promptly, including unfinished requests, while ordinary local work remains usable.

Default Agent reduces each model call's output budget to fit the remaining
credits. If a conservative UTF-8 input estimate leaves too little output, the
service can buffer up to half that input estimate at platform risk, while retaining
the full supplier reservation. User charges never exceed their reserved credits;
actual usage releases any surplus. A smaller budget may shorten or truncate the
response; remaining credits do not guarantee completion of a whole task. When the
buffered input and minimum output cannot fit, report insufficient credits for this request,
without claiming the balance is zero. A shorter conversation can reduce input
cost; otherwise the user can wait for refill or manage their plan.

The sidebar and Settings read the same available-credit snapshot. Refresh it when
opening the account menu, returning to the window, and finishing a Default Agent
turn (including failures and cancellations); poll while the signed-in surface is
mounted so other-device usage and settlement become visible. A failed refresh
must not present an old percentage as current. Display temporarily reserved
credits separately from available credits: active requests and unconfirmed fees
both hold capacity, and that capacity is already excluded from the available
percentage. A refusal involving reservations explains the hold and directs the
reader to current credits rather than claiming all credits are spent.

## Other Settings Decisions

- Automatic update checks run throughout an open application, every 15 minutes
  and on foreground return or system wake, with a shared five-minute activity
  throttle. Disabling automatic checks still permits a manual check at any time.
  A check that finds a release, automatic or manual, downloads it in the
  background without a notice. The sidebar speaks up only when the download is
  ready, offering Restart to update. A finished download never restarts the
  application by itself: installation is that explicit click, or the same action
  in Settings, and waits for affected document saves. Failure
  leaves the current application and downloaded update recoverable. Relaunch waits
  for the previous local service to release its port before opening the replacement.
  Development notification previews have no authority to invoke the updater.
  Offline, network-change, suspended-network and DNS failures during a check
  remain retryable and report as warnings. Repeated identical check warnings
  are counted in hourly windows; download, installation, certificate and
  integrity failures remain errors.
- Official desktop builds disclose default-on usage statistics and detailed error
  diagnostics under one opt-out. Signing in associates the preceding anonymous
  activity with the stable StashBase account, across installations. Installation
  and person identities remain separate; signing out or switching accounts retires
  the prior anonymous identity. No hardware fingerprint or document/chat content
  participates. Local activity remains usable without signing in.
  Diagnostic explanations, paths, stack traces, nested causes and bounded process
  output are retained to support debugging. Known credential patterns are filtered;
  documents, chats, arbitrary provider payloads and whole logs are not collected.
  Bounded offline delivery preserves occurrence time and identity. A submitted
  Agent turn can retain content-free progress and its result across restarts.
  If a prior host left no result, recovery reports an interrupted turn with an
  unknown outcome; it does not infer success, failure, or an exact end time.
  Lost connections and recoverable tool errors remain distinct from confirmed
  task failures. Opt-out stops
  pending delivery and erases queued work; re-enabling never backfills disabled
  activity. A signed-in account can be associated again after re-enabling.
  [Usage statistics](../../docs/usage-statistics.md) owns the event definitions,
  identity conventions, measurement limits and operator retention views.
  Test launches of official builds suppress collection before startup without
  changing the user's saved preference or analytics state.
- Bug reporting is a separate explicit review and local handoff. The approved
  snapshot cannot change during preparation; StashBase does not submit the report.

## Related Journeys

[J01](../journeys/README.md#j01-complete-onboarding-and-reach-first-value),
[J06](../journeys/README.md#j06-start-and-continue-an-agent-chat),
[J08](../journeys/README.md#j08-connect-an-external-agent-through-mcp),
[J09](../journeys/README.md#j09-prepare-and-hand-off-a-bug-report).

[Chat](../journeys/chat.md) owns first-send interaction. Implementation:
[credentials](../../code-review/architecture.md#credentials-and-external-access),
[updates](../../code-review/architecture.md#native-lifecycle-and-updates), and
[reporting](../../code-review/architecture.md#bug-report).


## Default Agent Subscriptions

A window that is signed out shows a banner in the notice strip, with or
without a folder open: "Sign in for free Agent credits every week." with Sign in
and Not now. It states what signing in gives, neither a commitment to use the
Default Agent nor the allowance's terms, which Settings → Agents shows. A completed sign-in or Not now answers it for
the installation until the next sign-out, which brings it back: signed out, the
reader is where the banner first found them. The sidebar account row
remains the account's only home, and the banner starts the same sign-in.

Plus and Pro add hosted Default Agent capacity; local files, writing tools,
Claude, Codex, and Antigravity access, and BYOK search remain independent. Settings → Agents shows
the signed-in account's plan, beside its credits; Plans and billing in the
sidebar account menu opens it there. A Free account sees each tier with its price and
Subscribe; a subscribed account sees its plan, paid-through or end date, and
Manage or cancel while the plan still renews. After cancellation, the same
portal action reads Manage billing, since nothing is left to cancel. Subscribe asks the hosted API, as the desktop account, for a
Stripe Checkout page and opens it in the system browser, so paying never requires
a website sign-in. Manage or cancel opens the Stripe Customer Portal the same
way. The desktop host holds the session token and verifies that the returned page
is Stripe-hosted; the renderer receives only that page, and no desktop session
token travels in a link. Promotion codes are entered on the Checkout page, which
shows the discount and renewal terms. Opening billing never sends a draft.

After Checkout opens, Settings shows that it is waiting for payment and polls
subscription rights, also re-reading them when the window regains focus. It stops
polling after two minutes and keeps the purchase buttons hidden until the reader
refreshes or dismisses the wait. Returning to the app restarts this bounded
confirmation window, including after a long Checkout. Management remains available
while confirmation is pending. Portal opening names the browser handoff; failures
clear the busy state and offer a retry. Billing HTTP requests have a twenty-second
HTTP deadline shared by retries; authentication retains its separate bounded
refresh call. System browser acknowledgement has a
ten-second deadline. Dismiss only closes the local wait and does not cancel a plan.
Confirmed rights refresh the credit balance. Portal return also polls for updated
rights, including cancellation and plan changes. Cancellation explicitly says
renewal is canceled and gives the remaining access date.
The browser returns to the website's pricing page, whose Return to StashBase button
works without a website session. Its data-free native link only focuses the app; The website remains an independent purchase
path for a browser-signed-in account.

Stripe owns prices, promotion codes, and payment management. The hosted API owns
subscription rights and usage. A discounted subscription receives its full tier
allowance. Paid credits follow the successfully paid monthly billing period.
A tier change preserves consumption within that period; an upgrade raises the
current ceiling. Free credits keep their separate seven-day window. Paid-tier changes use Stripe
prorations. Cancellation retains access until paid-through, then returns to Free.
A browser success redirect is not evidence of payment; pending confirmation stays
visible until the API confirms rights. Failed billing does not discard local work.

Unconfirmed fees stop occupying user credits after five minutes from the first
uncertain outcome. Reading credits or retrying triggers due refunds even when
the background recovery worker is delayed. Refunds are permanent for the user;
late provider accounting changes platform cost only. Normal active generations
do not become free just because execution lasts five minutes. Service safety
limits still apply to repeated failures and platform-paid waivers.
