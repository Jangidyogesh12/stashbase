import { EditorView } from '@codemirror/view';
import { act, fireEvent } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import type { AgentWorkspaceRuntime } from '@/features/agent/application/workspace-runtime';

/** Dispatches one key on `element` inside `act`, so the state it drives has
 *  settled by the time the assertion after it runs. */
export function pressKey(element: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    fireEvent.keyDown(element, { key, ...init });
  });
}

/** Dispatches a drag event that carries `dataTransfer` itself. Testing
 *  Library copies a given transfer onto a fresh one with read-only fields, so
 *  the `effectAllowed` or `dropEffect` a handler sets could not be read back. */
export function fireDrag(
  element: Element,
  type: 'dragend' | 'dragenter' | 'dragleave' | 'dragover' | 'dragstart' | 'drop',
  dataTransfer: DataTransfer,
): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  let notCancelled = true;
  act(() => {
    notCancelled = element.dispatchEvent(event);
  });
  return notCancelled;
}

/** The Agent message field is a CodeMirror document, and happy-dom cannot
 *  type into a contenteditable, so text enters through the editor view. */
export function editorOf(field: Element): EditorView {
  const host = field.closest('.cm-editor');
  const view = host instanceof HTMLElement ? EditorView.findFromDOM(host) : null;
  if (!view) throw new Error('No CodeMirror view behind the message field.');
  return view;
}

/** Appends `text` at the end of the composer document and leaves the caret
 *  after it, the way typing would. */
export function typeInto(field: Element, text: string): void {
  const view = editorOf(field);
  const at = view.state.doc.length;
  act(() => {
    view.dispatch({
      changes: { from: at, insert: text },
      selection: { anchor: at + text.length },
    });
  });
}

/** The draft the active Agent session holds, which is what the composer
 *  writes through to. */
export function draftOf(runtime: AgentWorkspaceRuntime): string {
  return runtime.activeSession().store.getState().draft;
}

/** Focus assertions go through `:focus` rather than `document.activeElement`,
 *  which the feature lint bans inside `ui` trees. */
export function expectFocused(element: Element): void {
  expect(element.matches(':focus')).toBe(true);
}

export function expectNotFocused(element: Element): void {
  expect(element.matches(':focus')).toBe(false);
}

/** happy-dom answers every media query against a fixed 1024px viewport. A
 *  test that needs the other branch — a compact window, a coarse pointer —
 *  pins the answer here; `unstubGlobals` puts the real one back afterwards. */
export function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
}
