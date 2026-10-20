# Design Docs

Start with [Overview](overview.md) for product identity and principles.
[Glossary](glossary.md) defines terms; [Visual Style](visual-style.md) sets visual intent.
Planned behavior stays in its owning design, clearly separate from current behavior.

## Vertical Designs: Journeys

Describe how a user completes a task: entry, meaningful steps, result, and recovery.
Link to shared capabilities instead of restating their rules.

- [User Journeys](journeys/README.md): stable J01–J14 task definitions and dependencies.
- [Working in Documents](journeys/documents.md): navigation, editing, and conflict decisions.
- [Working in Chat](journeys/chat.md): conversation, first send, and return to work.

## Horizontal Designs: Capabilities

Describe behavior shared across entry points: common rules, justified differences,
and consequential failure/cancellation/retry decisions. A capability is not a code
helper; these documents state product contracts, not implementation inventories.

| Capability | Owns |
|---|---|
| [Project Entry and Lifetime](capabilities/project-entry.md) | Project identity, acquisition, window selection, registration/removal |
| [Project Files](capabilities/project-files.md) | Format capabilities, source preservation, mutations, saving/release, planned prose diff |
| [Agent Sessions](capabilities/agent-sessions.md) | Conversation identity, readiness, submissions, execution, continuity and recovery |
| [Project Context](capabilities/project-context.md) | Preparation, indexing readiness, retrieval, and source evidence |
| [Account and Settings](capabilities/account-settings.md) | Access prerequisites, configuration scope, credentials, and shared settings decisions |
| [Scheduled Tasks](capabilities/scheduled-tasks.md) | Recurring agent requests: their file, switches, runs, and what the reader sees of them |

## Reading and Maintenance

For a user task, start with its journey and follow its capability links. For a
shared behavior, start with its capability and compare all affected journeys.
Read only relevant sections. [AGENTS.md](../AGENTS.md#vertical-and-horizontal-review)
defines when both reviews are required.

[Engineering Boundaries](../code-review/architecture.md) maps responsibilities to
implementation owners. [Journey Coverage](../code-review/journey-coverage.md) owns
current evidence and gaps; [Review Guide](../code-review/README.md) owns review steps.

Keep only decisions that constrain behavior or responsibility. Code explains
mechanics; tests own exact assertions. Remove repeated rules and completed review
narrative. [MAINTENANCE.md](../MAINTENANCE.md) owns documentation policy.
