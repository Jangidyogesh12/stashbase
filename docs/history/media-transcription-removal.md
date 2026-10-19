# Media transcription removal

Date: 2026-09-15. Baseline commit: `ab8d4c9b8678ab114648329d9dd6e1f1cb747ab3`.

This is a historical removal record requested by the maintainer, not an active
specification or a plan to restore the feature. The workspace already contained
uncommitted changes; the commit identifies the committed baseline, not those
additional edits.

## Decision

Remove audio/video transcription and native media conversion to focus on writing.
Keep ordinary project files and direct browser playback. Unsupported codecs have
an unavailable preview; users can open their source in an external application.
Media is excluded from preparation, retrieval, and agent/MCP content access.
PDF, DOCX, image preparation and their shared scheduler remain.
No migration or deletion of user-authored files or old downloaded models is added.

## Previous implementation

- [server/audio-transcription.ts](https://github.com/liliu-z/stashbase/blob/ab8d4c9b8678ab114648329d9dd6e1f1cb747ab3/server/audio-transcription.ts): preparation, checkpoints, transcript publication,
  fallback playback conversion, cancellation, and source freshness.
- `server/transcription-*.ts`, [server/whisper-cpp-provider.ts](https://github.com/liliu-z/stashbase/blob/ab8d4c9b8678ab114648329d9dd6e1f1cb747ab3/server/whisper-cpp-provider.ts),
  [server/audio-media-tools.ts](https://github.com/liliu-z/stashbase/blob/ab8d4c9b8678ab114648329d9dd6e1f1cb747ab3/server/audio-media-tools.ts): providers, models, runtime and FFmpeg execution.
- [shared/transcription.ts](https://github.com/liliu-z/stashbase/blob/ab8d4c9b8678ab114648329d9dd6e1f1cb747ab3/shared/transcription.ts), [shared/protocols/http/transcription.ts](https://github.com/liliu-z/stashbase/blob/ab8d4c9b8678ab114648329d9dd6e1f1cb747ab3/shared/protocols/http/transcription.ts),
  [server/routes/transcription.ts](https://github.com/liliu-z/stashbase/blob/ab8d4c9b8678ab114648329d9dd6e1f1cb747ab3/server/routes/transcription.ts): preferences and transport contracts.
- `renderer/src/features/settings/ui/transcription/` and its adapters/hooks:
  model installation and transcription preferences.
- `renderer/src/features/documents/ui/media/`: synchronized transcript, captions,
  seeking, find, and playback fallback.
- `native/transcription/`, `scripts/build-transcription-sidecar.sh`,
  [scripts/check-transcription-media.mjs](https://github.com/liliu-z/stashbase/blob/ab8d4c9b8678ab114648329d9dd6e1f1cb747ab3/scripts/check-transcription-media.mjs): pinned whisper.cpp/FFmpeg/Opus toolchain
  and platform packaging checks.
- Shared dispatch, derived storage, index status, file reads, Settings composition,
  packaging scripts and release workflows connected those pieces.

Inspect historical code with `git show <baseline>:<path>` or a detached checkout.
Current capability intent lives in the format matrix and Project Context design.

## Validation

Validated on 2026-09-15, with changes left uncommitted.

- Passed: host/Electron type checks, conversion scheduler (141 tests), project
  files (112), retrieval (25), configuration (57), packaging inputs (18),
  protocol/Electron tests, service builds, documentation validation, and the
  built Electron smoke suite.
- New regressions verify that media source bytes remain intact, preparation and
  agent/MCP content reads are refused, media is omitted from agent discovery
  and index admission, and original asset streaming retains Range support.
- The complete renderer gate passed architecture, size, duplication, formatting,
  lint, Story accessibility, type checking, and both builds. Its test run passed
  1,460 of 1,461 tests; an agent convergence test timed out and all three tests
  in that file passed on a focused rerun. Coverage completion is not claimed.
- Existing uncommitted agent work still prevents a green full gate:
  `use-agent-access.ts` violates signal/error-message conventions, and
  `agentAccessFailure` / `AGENT_RUNTIMES` are unused exports. The test inventory
  also reports the existing `server/routes/agent-preferences.test.ts` outside
  package scripts. These are outside the media removal.
- An isolated macOS Electron run used built renderer/server outputs and real
  MFS: a generated one-second WAV played directly from its source URL without
  a transcript; invalid MP4 bytes showed the external-application fallback.
  Only the Markdown fixture entered the project index. Screenshots were
  inspected. No packaged release, codec matrix, or real-provider quality is
  established by this pass.

The direct-source viewer has no supplied captions. Its narrowly scoped lint
configuration permits this instead of advertising an empty caption track.
