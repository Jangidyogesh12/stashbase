# Working on StashBase

## Product Context

StashBase is an **IDE for writing** in ordinary local projects. The main flow is:
enter a project → brainstorm with an agent → draft and revise → refine.
An empty project is valid; references, search, and wiki building are optional.

- **Documents mode** is a VSCode-like files/editor workspace.
- **Chat mode** is a Claude/ChatGPT-like conversation workspace.
- Both share the project and preserve unfinished work. A folder is a project
  scope and search namespace; the product has no global Library.

Local file handling, preparation, indexing, retrieval, and agent-assisted writing
are implemented, including inline prose revision. Existing file diffs and
save-conflict comparisons are separate. Defects and missing evidence are not
additional planned features.

Search UI says **By keyword / By meaning**; grep/hybrid are implementation strategies.

## Documentation Map

Use this map to find an answer, then the task routes below to choose what to read.
These documents are references, not a checklist to read in full for every task.

| Document | Question it answers |
|---|---|
| [README.md](README.md) | What is StashBase, and how do I get started? The short external introduction. |
| [Design Docs](design-docs/README.md) | What should the product do? Routes to product identity, terminology, vertical journeys, horizontal capabilities, and visual intent. Planned behavior stays in its owning design. |
| [Review Guide](code-review/README.md) | How should I scope a review, inspect a change, and report findings? |
| [Engineering Boundaries](code-review/architecture.md) | Which module or process owns a responsibility, and what rules must changes preserve? |
| [Journey Coverage](code-review/journey-coverage.md) | Which code implements a user journey, what evidence exists, and what remains unproven or broken? |
| [Release Runbook](code-review/release-pipeline.md) | How are source CI, packaging, signing, release verification, and publication performed? |
| [MAINTENANCE.md](MAINTENANCE.md) | Who maintains each kind of document, when should it change, and how are status and compatibility decisions recorded? |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How do I set up development and run focused or complete checks? |
| [User/operator guides](docs/) | How does a user or operator use and troubleshoot the product? |
| [Release checklists](release-checklists/) | What still needs checking in the packaged application? |

`CLAUDE.md` points to this file; `CONTEXT.md` points to the
[Glossary](design-docs/glossary.md). They do not define separate policies.

## Choose the Review Route

Read only the affected sections, then inspect the implementation and tests.
Respect the requested scope, including whether frontend UI is excluded.

| Task | Starting point and route |
|---|---|
| Discuss a design or feature | Product overview → [user journey](design-docs/journeys/README.md) → [shared capability](design-docs/README.md#horizontal-designs-capabilities) → engineering boundary → current code. Separate an agreed requirement from a proposed change. |
| Review a user journey | Select its Jxx section in [Journey Coverage](code-review/journey-coverage.md). Follow its renderer and host/service entries through the operation, failure, cancellation, and recovery paths. Read the linked product intent and boundaries. |
| Review a branch, commit, PR, or working tree | Pin the comparison point; include relevant uncommitted/new files. Follow the [diff-first route](code-review/README.md#diff-first-review), expanding through callers and crossed boundaries. |
| Diagnose or fix a bug | Find the affected journey/boundary, reproduce the failure, and trace its state owner. Verify the fix at the lowest useful layer and through the affected runtime flow when needed. |
| Measure or improve performance | Run the matching scenario in [scripts/profiling](scripts/profiling/README.md) before and after the change, and report the compared ranges. Add a scenario when none covers the task. |
| Simplify code or audit shared infrastructure | Start from [Engineering Boundaries](code-review/architecture.md). Trace real callers and the purpose they serve; absence from a journey map alone is not proof of dead code. |

## Vertical and Horizontal Review

- **Vertical — follow a user task.** Start with its Jxx journey and follow the
  entry through success, failure, cancellation, and recovery. Use Journey
  Coverage to find code and evidence, then identify the shared capabilities it uses.
- **Horizontal — compare the callers of a capability.** Start with its design
  and engineering owner. Trace real UI, agent, MCP, and background callers as
  applicable; compare identity, state, permissions, errors, and recovery. Look
  for duplicate rules and bypasses, while preserving intentional differences.
- **Use both when a change affects shared state or multiple entries.** Check
  the shared rule once at its owner, then the distinct risks at each affected
  entry. A local change does not require an audit of every journey.

Do not infer a unified implementation from a unified design. Identify current
owners in code; report consolidation opportunities separately from defects.
See the [review method](code-review/README.md#horizontal-review) for tracing details.

## Review Principles

- **Necessity:** connect code to a current user task or required infrastructure.
  For whole-product audits, follow the [necessity review](code-review/README.md#necessity-review):
  a caller, test, or old design paragraph alone does not justify retaining a feature.
  Question assumptions inherited from the former knowledge-base/global-Library
  model; optional wiki work must not become a prerequisite for writing.
- **Simplicity:** prefer one owner for each rule, state, and operation. Remove
  unused paths, duplicate logic, and unnecessary abstractions after checking
  callers. Do not preserve complexity merely because it already exists.
- **Correctness:** trace project scope, permissions, source versions, concurrent
  work, cancellation, disposal, and recovery. Failures must not broaden access,
  overwrite newer work, or silently report success.
- **Evidence:** code establishes current behavior; product docs establish intent.
  When they differ, record the mismatch. Tests prove only exercised paths;
  controlled fixtures do not establish real-provider quality or packaged behavior.
- **Compatibility:** remove historical-data-only migration/repair code under the
  [previous-version data policy](MAINTENANCE.md#previous-version-data-policy).
  Keep current validation, persistence, rollback, and crash recovery. User files
  and active external protocols are separate concerns.

Report findings with a code location, consequence, and supporting or missing
evidence. Distinguish defects from product proposals and maintenance judgments.
State what was reviewed, validated, and left unproven; do not equate a green
command or a complete map with a complete review.

## Documentation and Implementation

Before writing code, read the affected journey, shared capability, and engineering boundary.
Update them in the same change when behavior or constraints change; update the
Jxx entry when code ownership, evidence, or gaps change. Preserve stable journey IDs.

Keep each topic with its owner: product behavior in Design Docs, cross-module
rules in Engineering Boundaries, local rationale beside code, exact checks in
configuration, and assertions in tests. Keep the four-document review structure;
do not create a document for every module or retain completed research as a
second specification. All committed docs are English-only.

The renderer under `renderer/` is the frontend. Read
[the renderer boundary](code-review/architecture.md#renderer-boundaries) before
changing anything under `renderer/src`, and run `pnpm check:web`, the single
renderer gate used by CI. Exact rules live in the gate's configurations.

## GitHub access for this repository

For GitHub write operations on `liliu-z/stashbase` (including PR/issue
comments, reviews, merges, and workflow dispatches), use the locally
authenticated `gh` CLI directly. The GitHub Connector is authenticated as a
different account and does not have write access to this repository, so do not
probe a Connector write first. Connector reads remain available when useful.

## Temporary worktrees

Secondary Git worktrees do not inherit ignored local dependencies. Before
running Electron journeys that exercise indexing or sync, make sure the
worktree has `python/.venv.nosync`: reuse a working primary checkout's venv via
an explicit symlink when appropriate, or run `pnpm setup:python`. Without it,
`/api/index-status` and `/api/sync` return misleading 500 responses with
`ModuleNotFoundError: No module named 'mfs'`; treat that as worktree setup, not
as a product regression. Never commit the venv or its symlink.

## Electron launch environment

The agent host may inherit `ELECTRON_RUN_AS_NODE=1`. Remove it from the child
environment before any command that must launch Electron as a desktop runtime,
including Electron smoke tests and temporary visual harnesses.
On POSIX, run commands as
`env -u ELECTRON_RUN_AS_NODE pnpm test:electron:smoke` (and apply the same
prefix to the other Electron launch command). If `require('electron').app` is
undefined or a smoke fails at `app.setPath`, treat the inherited variable as
environment setup, not a product regression. Do not remove the variable from
flows that intentionally run Electron's embedded Node runtime.

## Development loop

When the user reports a bug or asks for a feature, run the full loop:

1. Locate and diagnose after reading the relevant design and engineering boundary sections.
2. Implement while preserving these cross-cutting constraints: sync and
   conversion are folder-explicit; hidden derived notes never surface; one
   daemon owns the local index; credentials live only in Settings, never env.
3. During implementation, run the smallest focused tests that exercise the
   changed behavior. Do not run the full validation matrix after every edit;
   reserve broad contract and build verification for the pre-commit gate
   unless a broader command is needed to diagnose the change.
4. Update affected docs in the same change. Run `pnpm test:docs` for changes to
   the documentation structure, links, contracts, or journey mapping as part
   of the pre-commit gate.
5. Leave work uncommitted until the user asks to commit.

## Test Selection

Test an observable result or a consequential failure: source preservation,
project isolation, permissions, concurrency, cancellation, and recovery.
Do not add tests solely to repeat constants, file lists, trivial forwarding,
or assertions already exercised by a Story. Keep one primary test owner per
rule; multiple layers need tests only when they introduce distinct risks.
Mocks prove local decisions, not a complete journey or real-provider quality.

Use [focused commands](CONTRIBUTING.md#testing) while editing. Run the complete
affected gate once after implementation, not after every edit. A completed
`pnpm check` satisfies its constituent gates; do not run them again without
new changes or a failed check. Build once and reuse those exact outputs within
the same validation run. Keep genuine evidence gaps in Journey Coverage.

## Pre-commit verification

Before creating commits, run the complete validation matrix for the pending
change:

- `pnpm typecheck` for host and renderer types; if `check:web` has already
  checked renderer types for this change, run only `pnpm typecheck:host`;
- `pnpm check:web` for renderer changes; it includes lint, coverage, Story
  accessibility, typecheck, architecture checks, and builds;
- focused commands for every affected engineering boundary;
- `pnpm test:docs` for documentation structure, links, contracts, or journey
  mapping changes;
- `pnpm test:electron` and `pnpm test:electron:smoke` for release-blocking
  renderer and cross-process paths;
- a driven runtime pass through the built application for a changed journey,
  recorded in the change itself. Journey automation and pixel baselines
  retired with the Playwright suites, so composition is reviewed by eye.

## Commit protocol

When the user asks to commit, group the dirty tree into focused commits by
theme—feature, fix, refactor, docs—without unrelated work. Match existing
subjects: `fix(scope): …`, `feat(scope): …`, `refactor(scope): …`,
`docs(scope): …`, `chore: …`. Split mixed-file hunks when needed so each
commit stands on its own. Do not push unless the user says push or asks for a
release.

## Release trigger

When the user asks to release or package a build, read and follow
[`code-review/release-pipeline.md`](code-review/release-pipeline.md) in full.
The only question is the patch/minor/major version choice; everything after it
runs unattended. Tidy focused commits, make the version bump the final commit,
and push `main` once. Successful exact-commit source CI triggers tagging and publication; do not
create a second release branch. Then verify all platform assets plus residual
packaged UI sanity.

Packaging is release-only. `pnpm dist:brew` is a local macOS fallback, not the
default. Never commit packaged artifacts; outputs belong in `release.nosync/`.
