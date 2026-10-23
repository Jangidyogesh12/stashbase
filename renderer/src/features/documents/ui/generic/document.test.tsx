import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { createDocumentRuntime } from '@/features/documents/application/document-runtime';
import { createDocumentNavigationRuntime } from '@/features/documents/application/navigation-runtime';
import {
  GenericFilePreviewError,
  type GenericFilePreviewPort,
} from '@/features/documents/application/ports';
import { documentQueryScope, genericPreviewApi } from '@/test/fakes/documents';
import { createTestQueryClient, withQueryClient } from '@/test/query';

import { GenericFileDocument, type GenericFileDocumentProps } from './document';

const FOLDER = '/project';

/** A preview call that never settles, for the pending panel. */
function pendingPreviewApi(): GenericFilePreviewPort {
  return genericPreviewApi({ load: vi.fn(() => new Promise<never>(() => undefined)) });
}

function renderDocument(api: GenericFilePreviewPort, path = 'vendor/archive.zip') {
  const runtime = createDocumentRuntime({
    activeFolderPath: FOLDER,
    generation: 1,
    id: 'tab-1',
    queries: documentQueryScope(),
    source: { folderPath: FOLDER, path },
  });
  const navigation = createDocumentNavigationRuntime('tab-1');
  const onReveal = vi.fn<GenericFileDocumentProps['onReveal']>(async () => undefined);
  const client = createTestQueryClient();
  withQueryClient(
    <GenericFileDocument
      active
      api={api}
      navigation={navigation}
      onReveal={onReveal}
      revealLabel="Show in file manager"
      runtime={runtime}
      status={({ name }) => <p role="status">{`Opening ${name}`}</p>}
    />,
    client,
  );
  disposals.push(() => {
    runtime.dispose();
    navigation.dispose();
    client.clear();
  });
  return { api, onReveal };
}

const disposals: Array<() => void> = [];

afterEach(() => {
  cleanup();
  for (const dispose of disposals.splice(0)) dispose();
});

describe('generic file document', () => {
  it('opens an XLSX inspection as a worksheet instead of the binary placeholder', async () => {
    renderDocument(
      genericPreviewApi({
        load: vi.fn(async () => ({
          kind: 'spreadsheet' as const,
          name: 'test.xlsx',
          size: 9000,
          version: 'sha256:workbook',
          workbook: {
            sheetCount: 1,
            hasFormulas: false,
            sheets: [
              {
                name: 'Sheet1',
                firstRow: 0,
                firstColumn: 0,
                rowCount: 1,
                columnCount: 1,
                rows: [['Workbook value']],
                formulas: [],
              },
            ],
          },
        })),
      }),
      'test.xlsx',
    );
    expect(await screen.findByRole('gridcell', { name: 'Workbook value' })).not.toBeNull();
    expect(screen.queryByText('Binary file cannot be opened')).toBeNull();
  });
  it('shows the format-neutral loading panel while the inspection is in flight', () => {
    renderDocument(pendingPreviewApi());

    expect(screen.getByRole('status').textContent).toBe('Opening archive.zip');
  });

  it('opens readable text as a read-only editor rather than a placeholder', async () => {
    renderDocument(
      genericPreviewApi({
        load: vi.fn(async () => ({
          content: 'host = localhost',
          kind: 'text' as const,
          name: 'settings.ini',
          size: 16,
        })),
      }),
      'settings.ini',
    );

    const editor = await screen.findByRole('textbox', { name: 'Read-only settings.ini source' });
    expect(editor.textContent).toContain('host = localhost');
  });

  it('names a binary file, sizes it, and offers only to reveal it on disk', async () => {
    const { onReveal } = renderDocument(
      genericPreviewApi({
        load: vi.fn(async () => ({ kind: 'binary' as const, name: 'archive.zip', size: 2_400 })),
      }),
    );

    expect(await screen.findByText('Binary file cannot be opened')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe(
      'This file is binary or does not contain valid UTF-8 text.',
    );
    expect(screen.getByText('archive.zip · 2.4 kB')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Show in file manager' }));
    expect(onReveal).toHaveBeenCalledWith(
      { folderPath: FOLDER, path: 'vendor/archive.zip' },
      expect.any(AbortSignal),
    );
  });

  it('leaves the size off a file whose size the inspection did not report', async () => {
    renderDocument(
      genericPreviewApi({
        load: vi.fn(async () => ({ kind: 'symlink' as const, name: 'linked-file' })),
      }),
      'linked-file',
    );

    expect(await screen.findByText('Symbolic link cannot be opened')).not.toBeNull();
    expect(screen.getByText('linked-file')).not.toBeNull();
  });

  it('says the reveal failed without losing the file it was showing', async () => {
    const { onReveal } = renderDocument(
      genericPreviewApi({
        load: vi.fn(async () => ({ kind: 'too-large' as const, name: 'dump.log', size: 0 })),
      }),
      'dump.log',
    );
    onReveal.mockRejectedValueOnce(new Error('no file manager'));

    expect(await screen.findByText('File is too large to open')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show in file manager' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The file could not be shown in the system file manager.',
    );
    expect(screen.getByText('File is too large to open')).not.toBeNull();
  });
});

describe('generic file document failures', () => {
  it('offers a retry and a reveal when the file could not be inspected', async () => {
    const load = vi
      .fn<GenericFilePreviewPort['load']>()
      .mockRejectedValueOnce(new GenericFilePreviewError('unavailable', 'offline'))
      .mockResolvedValue({ kind: 'binary', name: 'archive.zip', size: 8 });
    renderDocument(genericPreviewApi({ load }));

    expect(await screen.findByText('Could not inspect archive.zip')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(
      'The file could not be inspected. It has not been changed.',
    );
    expect(screen.getByRole('button', { name: 'Show in file manager' })).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Binary file cannot be opened')).not.toBeNull();
  });

  it('hands a file that belongs to another viewer back by name, with no recovery to offer', async () => {
    renderDocument(
      genericPreviewApi({
        load: vi
          .fn<GenericFilePreviewPort['load']>()
          .mockRejectedValue(new GenericFilePreviewError('not-generic', 'wrong viewer')),
      }),
      'notes/plan.md',
    );

    expect(await screen.findByText('plan.md')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(
      'This document viewer is not available yet.',
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show in file manager' })).toBeNull();
  });
});
