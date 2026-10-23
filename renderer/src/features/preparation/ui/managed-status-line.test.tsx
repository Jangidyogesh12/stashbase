import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { folderIndexStatus, preparationControlApi } from '@/test/fakes/preparation';
import { createTestQueryClient, queryWrapper } from '@/test/query';

import { SourcePreparationStatus } from './managed-status-line';

afterEach(cleanup);

describe('source preparation status', () => {
  it('reads only its own folder, never a same-named file in another', () => {
    const status = folderIndexStatus({
      folderPath: '/project/notes',
      pendingConversions: ['paper.pdf'],
    });
    const Wrapper = queryWrapper(createTestQueryClient());
    const { rerender } = render(
      <SourcePreparationStatus
        controlApi={preparationControlApi()}
        format="pdf"
        source={{ folderPath: '/project/notes', path: 'paper.pdf' }}
        status={status}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.queryByRole('status')).not.toBeNull();

    rerender(
      <SourcePreparationStatus
        controlApi={preparationControlApi()}
        format="pdf"
        source={{ folderPath: '/project/archive', path: 'paper.pdf' }}
        status={status}
      />,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});
