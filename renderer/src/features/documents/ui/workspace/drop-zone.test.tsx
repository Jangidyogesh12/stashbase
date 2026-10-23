import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { fireDrag } from '@/test/dom';

import { DocumentDropZone } from './drop-zone';

afterEach(cleanup);

function transfer(types: string[], files: File[] = []): DataTransfer {
  return { dropEffect: 'none', files, types } as unknown as DataTransfer;
}

function mount(onDropFiles?: (files: File[]) => void) {
  const editorDrop = vi.fn();
  const composerDrop = vi.fn();
  render(
    <DocumentDropZone notice={null} onDropFiles={onDropFiles}>
      <div
        data-testid="editor"
        onDragOver={(event) => event.preventDefault()}
        onDrop={editorDrop}
      />
      <iframe data-testid="preview" sandbox="" title="preview" />
      <div
        data-file-drop="attach"
        data-testid="composer"
        onDragOver={(event) => event.preventDefault()}
        onDrop={composerDrop}
      />
    </DocumentDropZone>,
  );
  return {
    composer: screen.getByTestId('composer'),
    composerDrop,
    editor: screen.getByTestId('editor'),
    editorDrop,
  };
}

const veil = () => screen.queryByTestId('document-drop-veil');

describe('DocumentDropZone', () => {
  it('marks where a desktop file will open, and takes the drop before an editor', async () => {
    const onDropFiles = vi.fn();
    const { editor, editorDrop } = mount(onDropFiles);
    const file = new File(['# Notes'], 'notes.md');
    const files = transfer(['Files'], [file]);

    fireDrag(document.body, 'dragenter', files);
    // The row marks the drag, which is what lets preview frames pass it through.
    expect(screen.getByTestId('preview').closest('[data-file-dragging]')).not.toBeNull();
    expect(fireDrag(editor, 'dragover', files)).toBe(false);
    expect(veil()).not.toBeNull();

    fireDrag(editor, 'drop', files);
    expect(onDropFiles).toHaveBeenCalledWith([file]);
    expect(editorDrop).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(veil()).toBeNull());
  });

  it('leaves the message box its own drop, and marks nothing over it', () => {
    const onDropFiles = vi.fn();
    const { composer, composerDrop } = mount(onDropFiles);
    const files = transfer(['Files'], [new File(['x'], 'notes.md')]);

    fireDrag(document.body, 'dragenter', files);
    fireDrag(composer, 'dragover', files);
    expect(veil()).toBeNull();
    fireDrag(composer, 'drop', files);
    expect(composerDrop).toHaveBeenCalled();
    expect(onDropFiles).not.toHaveBeenCalled();
  });

  it('marks nothing while the file is dragged outside the row', () => {
    mount(vi.fn());
    const outside = document.createElement('aside');
    document.body.append(outside);
    const files = transfer(['Files'], [new File(['x'], 'notes.md')]);
    fireDrag(outside, 'dragenter', files);
    fireDrag(outside, 'dragover', files);
    expect(veil()).toBeNull();
    outside.remove();
  });

  it('leaves drags from inside the app to whatever is under them', () => {
    const onDropFiles = vi.fn();
    const { editor, editorDrop } = mount(onDropFiles);
    const internal = transfer(['application/x-stashbase-source']);

    fireDrag(document.body, 'dragenter', internal);
    fireDrag(editor, 'dragover', internal);
    expect(veil()).toBeNull();
    fireDrag(editor, 'drop', internal);
    expect(editorDrop).toHaveBeenCalled();
    expect(onDropFiles).not.toHaveBeenCalled();
  });

  it('takes no desktop drop where a file has no location to open', () => {
    const { editor, editorDrop } = mount(undefined);
    const files = transfer(['Files'], [new File(['x'], 'notes.md')]);
    fireDrag(document.body, 'dragenter', files);
    fireDrag(editor, 'dragover', files);
    expect(veil()).toBeNull();
    fireDrag(editor, 'drop', files);
    expect(editorDrop).toHaveBeenCalled();
  });

  it('shows a drop it could not open until the reader dismisses it', () => {
    const onDismiss = vi.fn();
    render(
      <DocumentDropZone
        notice={{
          message: 'report.docx cannot open here. To add it to the project, drop it on Files.',
          onDismiss,
        }}
        onDropFiles={vi.fn()}
      >
        <div />
      </DocumentDropZone>,
    );
    expect(screen.getByRole('alert').textContent).toContain('report.docx cannot open here');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
