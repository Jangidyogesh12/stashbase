import { EditorState } from '@codemirror/state';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { GenericFilePreviewPort } from '@/features/documents/application/ports';
import {
  assetApi as assetApiFake,
  genericPreviewApi as genericPreviewApiFake,
  sourceApi,
} from '@/test/fakes/documents';

import {
  codeEditor,
  pending,
  registerSourceCleanup,
  renderSource,
} from './document-source.harness';

registerSourceCleanup();

describe('document viewer routing', () => {
  it('opens generic UTF-8 code in the shared read-only editor with Find', async () => {
    const api = sourceApi();
    const genericPreviewApi = genericPreviewApiFake({
      load: vi.fn<GenericFilePreviewPort['load']>(async () => ({
        content: 'export const answer = 42;\n',
        kind: 'text',
        name: 'src/answer.ts',
        size: 26,
        version: 'v1',
      })),
    });
    const { runtime } = renderSource(
      api,
      { folderPath: '/project/notes', path: 'src/answer.ts' },
      { genericPreviewApi },
    );

    await screen.findByLabelText('Read-only answer.ts source');
    const editor = codeEditor('Read-only answer.ts source');
    expect(editor.state.facet(EditorState.readOnly)).toBe(true);
    expect(editor.state.doc.toString()).toBe('export const answer = 42;\n');
    expect(api.load).not.toHaveBeenCalled();
    expect(genericPreviewApi.load).toHaveBeenCalledWith(
      { folderPath: '/project/notes', path: 'src/answer.ts' },
      expect.any(AbortSignal),
    );

    await waitFor(() => expect(runtime.navigation.store.getState().find.available).toBe(true));
    act(() => runtime.navigation.setFindQuery('answer'));
    await waitFor(() =>
      expect(runtime.navigation.store.getState().find).toMatchObject({ current: 1, total: 1 }),
    );
  });

  it('shows generic refusal metadata and reveals the exact source', async () => {
    const onReveal = vi.fn(async () => undefined);
    renderSource(
      sourceApi(),
      { folderPath: '/project/archive', path: 'assets/payload.bin' },
      {
        genericPreviewApi: genericPreviewApiFake({
          load: vi.fn<GenericFilePreviewPort['load']>(async () => ({
            kind: 'binary',
            name: 'assets/payload.bin',
            size: 1_250,
          })),
        }),
        onReveal,
      },
    );

    expect(await screen.findByText('Binary file cannot be opened')).not.toBeNull();
    expect(screen.getByText('assets/payload.bin · 1.3 kB')).not.toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show in file manager' }));
    expect(onReveal).toHaveBeenCalledWith(
      { folderPath: '/project/archive', path: 'assets/payload.bin' },
      expect.any(AbortSignal),
    );
  });

  it('keeps pending format-specific viewers distinct from generic failures', async () => {
    const assetApi = assetApiFake({ load: vi.fn(pending()) });
    const genericPreviewApi = genericPreviewApiFake({ load: vi.fn(pending()) });
    renderSource(
      sourceApi(),
      { folderPath: '/project/notes', path: 'report.pdf' },
      {
        assetApi,
        genericPreviewApi,
      },
    );

    expect(await screen.findByText('Loading report.pdf')).not.toBeNull();
    await waitFor(() => expect(assetApi.load).toHaveBeenCalled());
    expect(genericPreviewApi.load).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it.each(['archive.html', 'report.docx', 'interview.mp4'])(
    'routes %s through versioned preview assets',
    async (path) => {
      const assetApi = assetApiFake({ load: vi.fn(pending()) });
      const genericPreviewApi = genericPreviewApiFake({ load: vi.fn(pending()) });
      const api = sourceApi();
      renderSource(api, { folderPath: '/project/notes', path }, { assetApi, genericPreviewApi });

      expect(await screen.findByText(`Loading ${path}`)).not.toBeNull();
      await waitFor(() => expect(assetApi.load).toHaveBeenCalled());
      expect(api.load).not.toHaveBeenCalled();
      expect(genericPreviewApi.load).not.toHaveBeenCalled();
    },
  );

  it('queues DOCX preparation once on open and never for PDF or media', async () => {
    const assetApi = assetApiFake({ load: vi.fn(pending()) });
    for (const [path, queued] of [
      ['report.docx', 'docx'],
      ['interview.mp4', null],
      ['paper.pdf', null],
    ] as const) {
      const onOpenPrepared = vi.fn();
      renderSource(
        sourceApi(),
        { folderPath: '/project/notes', path },
        { assetApi, onOpenPrepared },
      );
      await waitFor(() => expect(assetApi.load).toHaveBeenCalled());
      expect(onOpenPrepared.mock.calls, path).toEqual(
        queued ? [[{ folderPath: '/project/notes', path }, queued]] : [],
      );
      cleanup();
    }
  });

  it('composes the preparation row above a loaded PDF viewer', async () => {
    const assetApi = assetApiFake({
      load: vi.fn(async () => ({ kind: 'source' as const, url: 'blob:pdf', version: '1' })),
    });
    const renderPreparation = vi.fn(() => <p data-testid="preparation">Reading page 2…</p>);
    renderSource(
      sourceApi(),
      { folderPath: '/project/notes', path: 'paper.pdf' },
      { assetApi, renderPreparation },
    );

    expect(await screen.findByTestId('preparation')).not.toBeNull();
    expect(renderPreparation).toHaveBeenCalledWith(
      { folderPath: '/project/notes', path: 'paper.pdf' },
      'pdf',
    );
  });
});
