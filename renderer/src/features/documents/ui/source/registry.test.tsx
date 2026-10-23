import { cleanup, screen } from '@testing-library/react';
import { FileQuestion } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { createDocumentQueryScope } from '@/features/documents/application/queries';
import { createDocumentTabsRuntime } from '@/features/documents/application/tabs-runtime';
import { DocumentWorkspace } from '@/features/documents/ui/workspace/workspace';
import {
  assetApi,
  docxPreviewApi,
  genericPreviewApi,
  sourceApi,
  tableApi,
} from '@/test/fakes/documents';
import { createTestQueryClient, withQueryClient } from '@/test/query';

import { documentViewerEntry, documentViewers } from './registry';
import type { DocumentViewerEntry, DocumentViewerProps } from './viewer';

const runtimes: ReturnType<typeof createDocumentTabsRuntime>[] = [];

afterEach(() => {
  cleanup();
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

/** One format's whole contribution: a viewer module and its status panel. */
function fakeEntry(overrides: Partial<DocumentViewerEntry> = {}): DocumentViewerEntry {
  return {
    component: ({ format, name }: DocumentViewerProps) => (
      <p data-testid="fake-viewer">
        {format} viewer for {name}
      </p>
    ),
    find: false,
    icon: () => FileQuestion,
    outline: false,
    services: [],
    status: ({ name }) => <p data-testid="fake-status">Opening {name}</p>,
    ...overrides,
  };
}

function renderWith(path: string, entry: DocumentViewerEntry) {
  const queryClient = createTestQueryClient();
  const runtime = createDocumentTabsRuntime({
    api: sourceApi({ load: vi.fn(() => new Promise<never>(() => undefined)) }),
    createId: () => 'tab-1',
    createQueries: (scope) => createDocumentQueryScope(queryClient, scope),
    folderPath: '/project/notes',
    generation: 1,
    restored: {
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', source: { folderPath: '/project/notes', path } }],
    },
  });
  runtimes.push(runtime);
  withQueryClient(
    <DocumentWorkspace
      assetApi={assetApi()}
      docxPreviewApi={docxPreviewApi()}
      genericPreviewApi={genericPreviewApi()}
      tableApi={tableApi()}
      onReveal={vi.fn(async () => undefined)}
      revealLabel="Show in file manager"
      runtime={runtime}
      sourceApi={sourceApi()}
      viewers={{ ...documentViewers, generic: entry }}
    />,
    queryClient,
  );
  return runtime;
}

describe('document viewer registry', () => {
  it('renders the viewer a registered entry declares for its format', async () => {
    renderWith('assets/payload.bin', fakeEntry());

    expect((await screen.findByTestId('fake-viewer')).textContent).toBe(
      'generic viewer for payload.bin',
    );
  });

  it('covers every format the workspace can classify', () => {
    for (const format of [
      'audio',
      'docx',
      'generic',
      'html',
      'image',
      'json',
      'md',
      'pdf',
      'txt',
    ] as const) {
      expect(documentViewerEntry(format).component).toBeDefined();
    }
  });

  it('offers Find only for the formats whose viewers claim a controller', () => {
    expect(documentViewerEntry('image').find).toBe(false);
    expect(documentViewerEntry('audio').find).toBe(false);
    for (const format of ['docx', 'html', 'json', 'md', 'pdf', 'txt'] as const) {
      expect(documentViewerEntry(format).find, format).toBe(true);
    }
  });

  it('declares an outline only for the formats that publish headings', () => {
    expect(documentViewerEntry('md').outline).toBe(true);
    expect(documentViewerEntry('docx').outline).toBe(true);
    for (const format of ['audio', 'generic', 'html', 'image', 'json', 'pdf', 'txt'] as const) {
      expect(documentViewerEntry(format).outline, format).toBe(false);
    }
  });

  it('withholds the find bar from a format that declares no Find', async () => {
    const runtime = renderWith('assets/payload.bin', fakeEntry());
    await screen.findByTestId('fake-viewer');

    expect(runtime.navigation.openFind()).toBe(false);
    expect(screen.queryByRole('textbox', { name: 'Find in document' })).toBeNull();
  });
});
