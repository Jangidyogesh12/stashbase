# Using StashBase

Start with [Start Writing](../README.md#start-writing): enter a project,
brainstorm with an agent, and begin drafting when ready.

## Choose a Folder and an Agent

The first launch opens at Welcome. Later launches, including a restart to
update, reopen the projects you had open. Open an existing folder, create an empty
project, import a public GitHub repository, or choose **Make a copy** in the
Gallery. Chat becomes available inside the project, even if it contains no
files. An entry's **Copy prompt** copies its build request for you to paste;
it does not start a conversation automatically.

Choose Claude, Codex, or Antigravity and sign in with your provider account.
A missing runtime waits for **Connect Claude**, **Connect Codex**, or
**Connect Antigravity** before installation. If Claude is too old for the model
you chose, the failed turn offers **Update Claude**. When a newer release of
your runtime is out, the model menu offers **Update** for it. **Settings → Agents**
shows each installed runtime's version, any newer release, and an **Update**
that runs the runtime's own updater in place. Release checks follow
**Check for updates automatically**.

Antigravity asks before changing files or running commands the same way the
others do, and offers Auto, Ask, Edit, and Plan. Its Auto is StashBase's: it
also runs commands that only read, searches the web, and reads pages, and still
asks before other commands. Its chat list lives in StashBase: removing a chat
there leaves the conversation in Antigravity.

If you can't use any of them, the built-in **Default Agent** provides a fallback
with free credits. Sign in to StashBase from the bottom of the sidebar or
**Settings → Agents**; no separate agent installation or model API key is required.

Start with an idea or question in the project's Chat. When ready, ask the
agent to create an outline or draft, or write directly in a new document.
References and search are available when useful; neither a wiki nor a
completed index is required to brainstorm.

For a source-filled project, you can ask your agent to organize references
into linked wiki pages. Search always targets one project,
and wiki maintenance runs only when requested.

## Read and Work Alongside Chat

Selecting a source opens it alongside the same conversation. The Files sidebar,
persistent tabs, and format-specific viewers let you browse, read, and edit
supported files directly.

- **Cmd/Ctrl+O:** find and open a file in the active folder.
- **Cmd/Ctrl+Shift+P** or **F1:** open the Command Palette.
- **Project name at the top of the sidebar:** switch to a recent project, or
  open, create, or import one. It opens in its own window.
- **File → New Window** or **Cmd/Ctrl+Shift+N:** work in another window.
- **Cmd/Ctrl+W:** close the active document tab.
- **@ mentions in Chat:** find a file or folder and insert its relative path.

Tool calls and file edits can be reviewed in Chat. Use **Persona** in the
composer to choose who the agent is when it talks and writes in this chat. Your
personas are shared by every project: Builder, Marketer, Journalist, and
Storyteller to start, any you write with **New persona…**, and any you add from
**Browse personas…**. Hover a persona to edit or delete it. A choice applies
from your next message in that chat, and new chats in the project start with
the persona you chose last. How the agent works belongs in your own `AGENTS.md`
or `CLAUDE.md`; StashBase never creates or rewrites them.

Default offers **Ask** (confirm changes and commands), **Edit** (allow ordinary
document writes in this project; confirm other actions), and **Plan** (read and
explore without writes or commands). Choose a mode between turns. Default has
no **Auto** option because its runtime has no automatic risk reviewer.

Drafting, editing, agent file-change reports, and save-conflict comparisons are
available, and so is the document diff: after the agent writes, choose
**Review** in **Changed in this turn** to undo or keep each change in the document.
Changes are already saved when you review them. **Keep all** leaves the saved
file unchanged; **Undo all** restores the earlier text. New files offer **Open**
instead of Review.

Select text in a Markdown document and choose **Heading** on the selection
toolbar to turn it into Text, Heading 1, Heading 2 or Heading 3. Deeper
headings, lists and quotes are in the `/` menu.

Some files can be listed without being searchable or editable. Muted files
are excluded from Search and automatic Chat context. Preview, editing,
retrieval text, and agent file access vary by format; see the canonical
[Format Capability Matrix](../design-docs/capabilities/project-files.md#format-capability-matrix).

## Turn On Search by Meaning

Keyword search needs no account or API key and is on from the start. Search
by meaning, which finds files even when the wording differs, is off until you
add an OpenAI or OpenRouter key under **Settings → Advanced → Search by meaning**. The
key is billed to you and is used only for search by meaning; signing in to
StashBase does not turn it on.

Once the key is saved, StashBase prepares registered projects and keeps their
search index synchronized, and the search panel gains a **By meaning** mode
beside **By keyword**. Removing the key turns it off again. This background
work is separate from an agent writing visible Wiki Pages. An OpenAI
restricted key needs embedding access for `text-embedding-3-small`;
model-list access is not required.

Search covers direct text in supported Markdown, UTF-8 plain text, HTML, and
JSON files, plus prepared text from PDFs, DOCX files, and images.
Results point back to the visible source file. Some material needs preparation
before it can appear; Search reports readiness, and failed preparation can be
retried.

Agents search the same way: text matching always, including prepared
document text, plus meaning-based evidence once a key is on.

Default Agent credits don't cover search by meaning. Check the account
menu at the bottom of the sidebar or **Settings → Agents** for the remaining
percentage and refill date.

## Preview Recordings

Audio and video files play directly when their codec is supported. Unsupported
files can be opened externally. Media is not prepared, searchable, or readable
as agent/MCP content.

## Manage Access

Folders join the project registry only when you explicitly add or open them,
including making a Gallery copy.
Removing a folder clears StashBase's state for it without deleting its files.

For an external agent client, keep StashBase running and register the
configuration from **Settings → Advanced → External apps (MCP)**. See
[MCP Configuration](mcp-configuration.md) for setup and access boundaries, and
[Your Files and Your Data](../README.md#your-files-and-your-data) for local and
cloud processing boundaries.
