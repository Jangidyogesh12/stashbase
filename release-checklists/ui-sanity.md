# Packaged UI Release Sanity

Run this short pass against release-candidate packages after source CI and the
platform packaging workflows succeed. It covers native, packaged, credentialed,
and media seams that no automated suite fakes.
It is not a second copy of the automated smoke suite.

`Jxx` labels refer to the stable product flows in
[`design-docs/journeys/README.md`](../design-docs/journeys/README.md). They show
which journey owns a residual check without duplicating the automated
coverage matrix.

Record one result per package/platform:

- Tag and commit SHA:
- CI run URL (successful for the exact commit):
- Coordinated Release workflow URL:
- Package/asset name and source:
- Platform and OS version:
- Tester and date:
- Start/end time (target: 10–15 minutes):
- Result: pass / fail / not applicable
- Evidence or issue links:
- Notes and every not-applicable reason:

Semantic-quality evaluation is deferred; provider baseline reports are not
required for publication. See the
[release policy](../code-review/release-pipeline.md#maintainer-handoff).

Use a disposable folder and non-sensitive test documents. Do not paste tokens,
credentials, personal documents, or private agent output into screenshots or
issue reports. Check an item only after observing the result; record a concise
reason when a platform cannot exercise it.

Before launching any test package, follow the
[telemetry suppression instructions](../docs/usage-statistics.md#testing-and-development).
Start the app with `STASHBASE_TELEMETRY_DISABLED=1` and verify the local telemetry
preferences report `available: false` before exercising flows. Reapply the override
to each new process, including update verification; versions without the override
need telemetry disabled in their disposable configuration before first launch.
Never use production PostHog as the test event sink.

## Residual checks

- [ ] **J01** — Install or unpack the release asset and launch it through the platform's
  normal path. Confirm one window appears and quits cleanly. On macOS, confirm
  Gatekeeper accepts the downloaded Developer ID-signed, notarized app without
  a security override; preserve the automated `codesign`, `spctl`, and stapler
  results with the release evidence.
- [ ] **J01** — On each platform, start from the previous published version N,
  point it at the ordinary stable release channel, and update to this candidate
  N+1. Leave a harmless edit open and run **Check for updates** in Settings.
  Confirm the download finishes in the background and the application keeps
  running until **Restart to update** appears in the sidebar. Click it once and
  confirm save-barrier handling, installation, relaunch, the N+1 version, and
  exactly one running instance. Exercise macOS from the installed DMG app,
  Windows from NSIS, and Linux from AppImage; also exercise deb when it is a
  supported distribution path and record the expected administrator prompt.
  A unit-test updater double or a release-asset inventory is not evidence for
  this item. Record the observed N and N+1 versions plus the installed asset
  name; do not call the update path verified until every supported platform has
  a real result.
- [ ] **J02** — Use the real native folder picker: cancel once without changing the
  project registry, then add a disposable folder and confirm it opens.
- [ ] **J02 / J06** — Drag a real OS file or folder onto each supported drop target and confirm
  the intended import/attachment behavior and rejection feedback.
- [ ] **J01 / J03** — Exercise native menus and the platform shortcuts for Quick Open, Command
  Palette, search, Settings, window close, and quit. Confirm focus returns to a
  sensible control after dismissing an overlay, and confirm View exposes no
  Reload or Force Reload bypass.
- [ ] **J06** — With tester-owned credentials and an installed supported CLI, send one
  harmless agent turn. Confirm streaming/activity, one permission or stop
  interaction when available, completion, and a clean close. Never use a real
  user workspace or capture credentials in evidence.
- [ ] **J06** — On each platform, enable desktop notifications in General, then
  background/minimize the app while an agent awaits approval or an answer. Confirm
  one native notification, click it physically, and verify the owning window/chat
  and pending card receive focus without approving anything. Repeat with an
  inactive chat and a second window. Foreground requests stay quiet; resolution,
  Stop, window close and opting out revoke stale clicks. Relaunch to check opt-out
  persistence. Test Windows from the NSIS-installed Start Menu shortcut, macOS from
  the signed installed app, and Linux AppImage/deb with a desktop notification
  service. Record the Linux desktop environment. Also test system permission denial
  or Do Not Disturb: work must remain usable and Settings must not claim banners
  are authorized just because the native API is available.
- [ ] **J06** — After declining or disabling system notifications, use General's
  system permission row to open the OS notification settings and allow StashBase.
  Return to the app and verify availability refreshes without changing app switches
  or replaying old outcomes; authorization remains unknown in the UI. Check macOS,
  Windows, Linux GNOME and KDE. On an unsupported Linux desktop or with its settings
  app missing, verify manual instructions. A failed launch must offer quiet recovery
  and retain those instructions. Confirm a new background task can then notify.
- [ ] **J06** — Check the menu-bar/tray while two windows contain working,
  waiting, stopped, completed and failed chats. Only work still in progress is
  listed under Running; completed/failed/stopped chats leave the menu. Titles
  stay stable through working/waiting transitions; duplicate titles show project names;
  physically select an inactive chat and confirm its window and pending request
  receive focus without approval. Closing a chat, renderer or window revokes its
  menu entry. Notifications off must still show work state. Check macOS template
  images in light/dark menu bars and Retina scale, Windows tray and taskbar
  overlays, and Linux with/without a tray host and LauncherEntry integration.
  Background attention shows a Dock/taskbar mark; resolved requests, owner focus
  for outcomes, opt-out and quit clear it. Verify existing last-window-close and
  unsaved-work-on-Quit behavior. A denied OS badge permission must not break work.
- [ ] **J06** — Background the app for a successful turn and a failed turn; confirm
  the matching notification opens its result/error. Stop during startup and during
  a running turn; neither should notify, even if cancellation later fails. Disable
  each notification category independently, verify other categories still work,
  then relaunch and check persistence. Foreground outcomes, disabled outcomes and
  loaded history must not appear later when backgrounding or re-enabling. Check
  a result from an inactive chat and an earlier transcript page.
- [ ] **J05 / J07 / J10** — In a disposable project with one non-sensitive source and
  one Markdown Canvas, confirm searching by meaning returns the source, ask the
  real agent to use that evidence and write an accepted result into the Canvas,
  approve the write, review and edit the file, then close and reopen it. Confirm
  keyword search can find the new durable content. This is a packaged integration
  check; it does not establish representative semantic retrieval quality.
- **J11 is retired:** chat starts in an open project; no conversation migration.
- [ ] **J06** — Paste one non-sensitive clipboard image into the agent composer. Confirm
  the attachment preview appears and accompanying text remains.
- [ ] **J09** — Open **Report a Bug…** from the native Help menu. Review the bounded
  screenshot/log previews, exclude one available artifact, prepare the report,
  and use Download. Confirm only the selected files appear in one new Downloads
  folder and nothing is submitted automatically. When browser access is safe,
  also confirm **Open GitHub** opens the prefilled issue without placing logs or
  local paths in the URL.
- [ ] **J04** — With a fresh component cache, prepare a PDF and image from the
  installed release. Confirm the live release component downloads without a
  confirmation, waiting preparation resumes, and macOS accepts the independently
  signed/notarized executable. Interrupt an initial download and confirm it
  shows the contextual Retry download action in preparation or search, or waits
  for one attempt on the next launch. Restart offline after installation and prepare
  another fixture using the same cache. Local HTTP fixture transport is not evidence for this check.
- [ ] **J03 / J04** — Open representative real PDF, DOCX, image, and audio fixtures in the
  packaged app on platforms where those formats ship. The automated journey
  uses synthetic/minimal fixtures; here confirm production rendering and, for
  audio, that play/pause and seeking produce sound and preserve control state.
- [ ] **J01 / J02 / J03** — Open a second window, switch folders, close both windows, relaunch, and
  confirm no orphan process/port, duplicate unexpected window, or lost save.

If a check fails, keep the candidate unpublished or stop the rollout, attach
sanitized evidence, and file the smallest reproducible issue. Re-run the failed
item and any adjacent native boundary after a replacement package is built.
