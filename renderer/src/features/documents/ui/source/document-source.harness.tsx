/**
 * One open source tab in a mounted Documents workspace, for the suites that
 * exercise a document through it.
 *
 * Text, JSON, Markdown, conflict, and viewer behaviour all run between a real
 * tabs runtime, its query scope, and the workspace that renders the active
 * tab, so each suite needs the same standing workspace with one restored tab.
 * The wiring is here so the suites cannot drift into testing slightly
 * different workspaces.
 *
 * Only a test file imports this.
 */
import { EditorView } from '@codemirror/view';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, vi } from 'vite-plus/test';

import type { DocumentSourcePort } from '@/features/documents/application/ports';
import { createDocumentQueryScope } from '@/features/documents/application/queries';
import { createDocumentTabsRuntime } from '@/features/documents/application/tabs-runtime';
import {
  DocumentWorkspace,
  type DocumentWorkspaceProps,
} from '@/features/documents/ui/workspace/workspace';
import { assetApi, docxPreviewApi, genericPreviewApi, tableApi } from '@/test/fakes/documents';
import { createTestQueryClient, withQueryClient } from '@/test/query';

/** A port call that never settles, for the viewers a test leaves pending. */
export function pending(): () => Promise<never> {
  return () => new Promise<never>(() => undefined);
}

const runtimes: ReturnType<typeof createDocumentTabsRuntime>[] = [];

/**
 * Tear the workspace down after each test in the calling suite.
 *
 * Called rather than registered at import, so each suite states that it owns
 * the teardown. A runtime left running keeps its tabs and timers past the
 * test that made it.
 */
export function registerSourceCleanup(): void {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    for (const runtime of runtimes.splice(0)) runtime.dispose();
  });
}

/** The workspace props a suite may replace; the rest stay pending fakes. */
type SourceOptions = Partial<
  Pick<
    DocumentWorkspaceProps,
    | 'assetApi'
    | 'genericPreviewApi'
    | 'onAskAgent'
    | 'tableApi'
    | 'onNavigate'
    | 'onOpenExternal'
    | 'onOpenPrepared'
    | 'onReveal'
    | 'renderPreparation'
  >
>;

/** Mount the workspace with `source` restored as its one active tab. */
export function renderSource(
  api: DocumentSourcePort,
  source = { folderPath: '/project/notes', path: 'plan.md' },
  options: SourceOptions = {},
) {
  const queryClient = createTestQueryClient();
  let nextId = 1;
  const runtime = createDocumentTabsRuntime({
    api,
    createId: () => `tab-${++nextId}`,
    createQueries: (scope) => createDocumentQueryScope(queryClient, scope),
    folderPath: '/project/notes',
    generation: 1,
    restored: {
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', source }],
    },
  });
  runtimes.push(runtime);
  withQueryClient(
    <DocumentWorkspace
      assetApi={options.assetApi ?? assetApi({ load: vi.fn(pending()) })}
      docxPreviewApi={docxPreviewApi({ load: vi.fn(pending()) })}
      genericPreviewApi={options.genericPreviewApi ?? genericPreviewApi({ load: vi.fn(pending()) })}
      tableApi={options.tableApi ?? tableApi()}
      onAskAgent={options.onAskAgent}
      onNavigate={options.onNavigate}
      onOpenExternal={options.onOpenExternal}
      onOpenPrepared={options.onOpenPrepared}
      onReveal={options.onReveal ?? vi.fn(async () => undefined)}
      renderPreparation={options.renderPreparation}
      revealLabel="Show in file manager"
      runtime={runtime}
      sourceApi={api}
    />,
    queryClient,
  );
  return { queryClient, runtime };
}

/** The CodeMirror view behind the editor labelled `label`. */
export function codeEditor(label: string): EditorView {
  const content = screen.getByLabelText(label);
  const editor = content.closest<HTMLElement>('.cm-editor');
  const view = editor ? EditorView.findFromDOM(editor) : null;
  if (!view) throw new Error(`Could not find CodeMirror editor for ${label}.`);
  return view;
}
