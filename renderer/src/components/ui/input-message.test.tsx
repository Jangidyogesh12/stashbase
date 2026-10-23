import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { expectNoA11yViolations } from '@/test/axe';

import { InputMessage, type InputMessageEditorContext } from './input-message';

afterEach(cleanup);

function previewContext(suggested: boolean) {
  return (
    <>
      <span>Selected passage</span>
      {suggested && <span>Suggested file</span>}
    </>
  );
}

it('shrinks the preview region after a wrapped file reference is removed', async () => {
  const observers = new Map<Element, () => void>();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      observe(node: Element) {
        observers.set(node, this.callback);
      }
      unobserve(node: Element) {
        observers.delete(node);
      }
      disconnect() {}
    },
  );
  try {
    const seen: { context: InputMessageEditorContext | null } = { context: null };
    const view = render(fullComposer(seen, { previewSlot: previewContext(true) }));
    // dom-contract: the measured content and its animated clipping parent;
    // happy-dom has no layout, so reproduce Chromium's scrollHeight floor.
    const row = screen.getByText('Selected passage').parentElement;
    const clip = row?.parentElement;
    if (!row || !clip) throw new Error('Missing preview region');
    let contentHeight = 68;
    Object.defineProperty(row, 'offsetHeight', { get: () => contentHeight });
    Object.defineProperty(clip, 'scrollHeight', {
      get: () => Math.max(contentHeight, Number.parseFloat(clip.style.height) || 0),
    });
    const resize = observers.get(row);
    if (!resize) throw new Error('Preview content is not observed');
    act(resize);
    await waitFor(() => expect(clip.style.height).toBe('68px'));

    view.rerender(fullComposer(seen, { previewSlot: previewContext(false) }));
    contentHeight = 32;
    act(resize);
    await waitFor(() => expect(clip.style.height).toBe('32px'));
    expect(screen.queryByText('Suggested file')).toBeNull();
    expect(screen.getByText('Selected passage')).not.toBeNull();
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});

/** The consumer's field — the composer has none of its own — recording the
 *  last context the composer handed it and submitting on Enter, which is what
 *  the composer's `submit` exists for. */
function editorSlot(seen: { context: InputMessageEditorContext | null }) {
  return function ConsumerEditor(ctx: InputMessageEditorContext) {
    seen.context = ctx;
    return (
      <div
        aria-label={ctx.ariaLabel}
        contentEditable="true"
        data-testid="editor"
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault();
          ctx.submit();
        }}
        role="textbox"
        tabIndex={0}
      />
    );
  };
}

function sendButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Send' });
}

describe('InputMessage editor slot', () => {
  it('renders the consumer editor with the step metrics and submits through it', async () => {
    const onSend = vi.fn();
    const seen: { context: InputMessageEditorContext | null } = { context: null };
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const view = render(
      <InputMessage
        editor={editorSlot(seen)}
        files={[file]}
        onFilesChange={vi.fn()}
        onSend={onSend}
        onValueChange={vi.fn()}
        placeholder="Ask"
        value="Hello"
      />,
    );
    expect(screen.getByTestId('editor')).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Message' })?.tagName).toBe('DIV');
    expect(seen.context).toMatchObject({
      ariaLabel: 'Message',
      disabled: false,
      maxRows: 8,
      minRows: 1,
      placeholder: 'Ask',
      value: 'Hello',
    });
    // The contract is that the editor is handed the composer's step
    // typography, not any particular pixel size.
    const metrics = seen.context?.metrics;
    expect(metrics?.fontSize).toBeGreaterThan(0);
    expect(metrics?.lineHeight).toBeGreaterThan(metrics?.fontSize ?? 0);
    expect(metrics?.paddingX).toBeGreaterThan(0);
    expect(metrics?.paddingY).toBeGreaterThan(0);

    await userEvent.setup().click(sendButton());
    expect(onSend).toHaveBeenCalledWith('Hello', [file]);
    await expectNoA11yViolations(view.container);
  });

  it('sends an empty draft only when the consumer says it carries something', async () => {
    const onSend = vi.fn();
    const seen: { context: InputMessageEditorContext | null } = { context: null };
    const user = userEvent.setup();
    const view = render(
      <InputMessage editor={editorSlot(seen)} onSend={onSend} onValueChange={vi.fn()} value="" />,
    );
    expect(sendButton().hasAttribute('disabled')).toBe(true);
    await user.click(sendButton());
    expect(onSend).not.toHaveBeenCalled();

    view.rerender(
      <InputMessage
        editor={editorSlot(seen)}
        onSend={onSend}
        onValueChange={vi.fn()}
        sendableWithoutText
        value=""
      />,
    );
    expect(sendButton().hasAttribute('disabled')).toBe(false);
    await user.click(sendButton());
    expect(onSend).toHaveBeenCalledWith('', []);
    await expectNoA11yViolations(view.container);
  });
});

/** Every region wired at once, so the split modules are exercised through the
 *  one public component. */
function fullComposer(
  seen: { context: InputMessageEditorContext | null },
  overrides: Partial<ComponentProps<typeof InputMessage>> = {},
) {
  return (
    <InputMessage
      editor={editorSlot(seen)}
      files={[]}
      onFilesChange={vi.fn()}
      onQueueChange={vi.fn()}
      onSend={vi.fn()}
      onStop={vi.fn()}
      onValueChange={vi.fn()}
      status="idle"
      value=""
      {...overrides}
    />
  );
}

describe('InputMessage composer regions', () => {
  it('renders the field, the attachments and the queue as one accessible surface', async () => {
    const seen: { context: InputMessageEditorContext | null } = { context: null };
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const view = render(
      fullComposer(seen, {
        files: [file],
        queue: [{ files: [], id: 'q1', text: 'queued draft' }],
        status: 'streaming',
      }),
    );

    // Files region.
    expect(screen.getByRole('button', { name: 'Remove shot.png' })).not.toBeNull();
    // Queue region.
    expect(screen.getByLabelText('Queued message 1 of 1: queued draft')).not.toBeNull();
    // The field is the consumer's, named by the composer.
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toBeNull();

    await expectNoA11yViolations(view.container);
  });

  it('names the field from the caller and swaps the placeholder for the drop hint', () => {
    const seen: { context: InputMessageEditorContext | null } = { context: null };
    render(
      fullComposer(seen, {
        fieldProps: { 'aria-describedby': 'hint', 'aria-label': 'Ask the agent' },
        placeholder: 'Ask',
      }),
    );
    expect(seen.context).toMatchObject({
      ariaDescribedBy: 'hint',
      ariaLabel: 'Ask the agent',
      placeholder: 'Ask',
    });
  });

  it('queues a draft without interpreting completion as permission to dispatch', async () => {
    const seen: { context: InputMessageEditorContext | null } = { context: null };
    const onQueueChange = vi.fn();
    const onSend = vi.fn();
    const onStop = vi.fn();
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    const view = render(
      fullComposer(seen, {
        onQueueChange,
        onSend,
        onStop,
        onValueChange,
        status: 'streaming',
        value: 'hello',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onQueueChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.keyboard('{Enter}');
    expect(onQueueChange).toHaveBeenCalledWith([
      { files: [], id: expect.any(String), text: 'hello' },
    ]);

    const queued = { files: [], id: 'q1', text: 'hello' };
    view.rerender(
      fullComposer(seen, {
        onQueueChange,
        onSend,
        queue: [queued],
        status: 'streaming',
        value: '',
      }),
    );
    onQueueChange.mockClear();
    view.rerender(
      fullComposer(seen, { onQueueChange, onSend, queue: [queued], status: 'idle', value: '' }),
    );
    expect(onQueueChange).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('hands a mid-response draft to the response when the owner takes it, and queues on request', async () => {
    const seen: { context: InputMessageEditorContext | null } = { context: null };
    const onQueueChange = vi.fn();
    const onSteer = vi.fn();
    const onValueChange = vi.fn();
    const props = { onQueueChange, onSteer, onValueChange, status: 'streaming' as const };
    const view = render(fullComposer(seen, { ...props, value: 'keep it short' }));

    expect(screen.getByRole('button', { name: 'Send now' })).not.toBeNull();
    await userEvent.click(screen.getByRole('textbox', { name: 'Message' }));
    await userEvent.keyboard('{Enter}');
    expect(onSteer).toHaveBeenCalledWith('keep it short', []);
    expect(onQueueChange).not.toHaveBeenCalled();
    expect(onValueChange).toHaveBeenLastCalledWith('');

    view.rerender(fullComposer(seen, { ...props, value: 'after that, a title' }));
    seen.context?.submit({ queue: true });
    expect(onSteer).toHaveBeenCalledOnce();
    expect(onQueueChange).toHaveBeenCalledWith([
      { files: [], id: expect.any(String), text: 'after that, a title' },
    ]);
  });

  it('removes an attachment from the preview row', async () => {
    const seen: { context: InputMessageEditorContext | null } = { context: null };
    const onFilesChange = vi.fn();
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const user = userEvent.setup();
    render(fullComposer(seen, { files: [file], onFilesChange }));

    await user.click(screen.getByRole('button', { name: 'Remove shot.png' }));
    expect(onFilesChange).toHaveBeenCalledWith([]);
  });

  it('accepts any file when the consumer supplies no file-type restriction', () => {
    const seen: { context: InputMessageEditorContext | null } = { context: null };
    const onFilesChange = vi.fn();
    const archive = new File(['bytes'], 'sources.zip', { type: 'application/zip' });
    const view = render(fullComposer(seen, { accept: '', files: [], onFilesChange }));
    const surface = view.container.firstElementChild;
    if (!(surface instanceof HTMLElement)) throw new Error('composer surface was not rendered');

    fireEvent.drop(surface, {
      dataTransfer: { files: [archive], types: ['Files'] },
    });

    expect(onFilesChange).toHaveBeenCalledWith([archive]);
  });
});
