# Overview

StashBase is an **IDE for writing**: develop ideas with an agent and turn them
into documents in ordinary local projects.

Enter a project → brainstorm → write → refine.

Chat always starts inside a project. Welcome does not create conversations;
creating another project does not transfer a conversation or its history.

An empty project is valid. Discussion can remain exploration or lead to writing;
references, search, and wiki building are optional. Typical work includes articles,
reports, proposals, research notes, and returning to earlier drafts.

## Working Modes

- **Documents:** a VSCode-like file and editor workspace.
- **Chat:** a Claude/ChatGPT-like conversation workspace.

Both share the project and preserve unfinished work when switching.
[Documents](journeys/documents.md) and [Chat](journeys/chat.md) define their flows.

## Product Principles

- **Ordinary files are authoritative.** Documents and agent-written wiki pages
  remain user-owned; extracted text, checkpoints, and indexes stay hidden.
- **One project scope.** Each folder has an independent search namespace.
  Missing results or failures never broaden access.
- **Deliberate actions.** Discussion does not implicitly authorize file changes,
  attach an open document, install a runtime, or start sign-in.
- **Local work stays available.** Browsing, editing, preview, and keyword search
  require no account. Agent and optional embedding requests use their configured
  services; local ownership does not imply offline model execution.
- **Preserve continuity.** Mode changes and background work retain documents,
  conversations, and drafts. Failures offer recovery without silently losing work.

OpenQuill, Claude, Codex, and Antigravity use the same project/file model. Preparation,
retrieval, MCP, and Gallery support that work without creating a separate store.

## Feature Status

Project entry, discussion, drafting, editing, preparation, indexing, and retrieval
and document-specific diff are implemented; its scope is in
[Project Files](capabilities/project-files.md#document-specific-diff). Known limitations and missing evidence
remain in the owning designs and [Journey Coverage](../code-review/journey-coverage.md).
