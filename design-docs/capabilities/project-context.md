# Project Context

## Scope

Documents, search, built-in Agents, and external MCP clients can use project
material as evidence. Preparation and indexing are optional support for writing;
an empty project and a conversation without references are valid.

## Preparation and Evidence

- Keep original sources authoritative. Extracted text and indexes stay hidden;
  Agent-written documents remain ordinary project files.
- Apply search and preparation exclusions within the selected project. A project
  remains searchable when its parent path is hidden, including a cloud drive's
  internal mount path; hidden directories inside the project stay excluded.
- Publish only complete, current preparation output. Partial, stale, cancelled,
  or orphaned output cannot serve as evidence. Empty completed OCR, including a
  textless PDF, is a valid non-searchable result; an OCR execution failure is not.
  PDFs with missing extracted text try local OCR without changing the original.
  The [format matrix](project-files.md#format-capability-matrix)
  defines which sources participate.
- Preview, preparation, and semantic-index readiness are separate. Background work
  prioritizes interaction without blocking unrelated documents or conversation.
- Local PDF/OCR components download on first demand and work offline thereafter.
  Updating the app reuses an installed component when that component is unchanged.
  Failed setup offers retry beside a waiting document, or one retry on next launch.
  Cancelled source demand cannot silently resume; independently requested component
  installation may continue. Downloads do not send source bytes or steal focus.
- An unsupported native component is a capability limitation, not a setup retry.
  Explain the limitation without downloading incompatible binaries or blocking
  project browsing and editing. Search can be unavailable on systems where its
  native backend cannot run; neither search mode may pretend to succeed there.
- Explicit source cancellation remains stopped until Reprocess. Shutdown interruption
  is recoverable. Storage failure must not report durable cancellation or silently
  restart work whose state cannot be established.

## Retrieval and Access Differences

| Caller or mode | Required behavior |
|---|---|
| By keyword | Works without account or embedding setup. |
| By meaning | Opt-in with a Settings embedding key; preparation can finish while vectors are still indexing. |
| Agent context | Always bound to the conversation's project. |
| External MCP | Select one authorized registered project explicitly. |
| Tool search without an explicit mode | Use keyword without an embedding key, hybrid with one, according to current configuration. |

Search offers a direct setup entry when search by meaning is not configured.
An explicit search mode is honored. Missing configuration or provider failure
cannot silently change strategies. Removing the embedding key retains keyword
search and prepared-file access; Default Agent credits never configure search.

## Failure and Recovery

Every result resolves to an authorized visible source with its available locator.
Visibility alone does not grant retrieval or tool access. Missing results,
invalid identity, and failures never broaden project scope.

Keep empty results distinct from failed or partial work. Withhold known-stale
evidence, show remaining usable results, and recover the affected preparation,
index, or provider state. Bounded reads identify their extent. Search by meaning
requires representative quality evaluation, beyond transport correctness.

## Related Journeys

[J04](../journeys/README.md#j04-prepare-a-hard-to-read-file),
[J05](../journeys/README.md#j05-search-and-open-source-evidence),
[J08](../journeys/README.md#j08-connect-an-external-agent-through-mcp),
[J10](../journeys/README.md#j10-turn-a-local-project-into-durable-agent-assisted-work),
[J12](../journeys/README.md#j12-build-wiki-pages-from-a-local-folder).

Implementation: [preparation and retrieval](../../code-review/architecture.md#preparation-and-retrieval).
Credentials: [Account and Settings](account-settings.md).
