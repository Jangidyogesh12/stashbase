import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { InputMessageEditorContext } from '@/components/ui/input-message';
import type { ContextStatus } from '@/features/agent/domain/context';
import { editorOf, pressKey } from '@/test/dom';

import {
  chipRuns,
  MentionEditor,
  serialize,
  type MentionEditorHandle,
  type MentionEditorProps,
} from './mention-editor';

afterEach(cleanup);

const metrics = { fontSize: 14, lineHeight: 20, paddingX: 8, paddingY: 8 };

interface Harness {
  acceptPlaceholder?: boolean;
  placeholder?: string;
  value?: string;
  chipPaths?: string[];
  statuses?: Record<string, ContextStatus>;
  listboxOpen?: boolean;
  skill?: { id: string; label: string } | null;
  skillsEnabled?: boolean;
}

function harness(options: Harness = {}) {
  const spies = {
    onAccept: vi.fn(() => true),
    onDismiss: vi.fn(),
    onMentionAdded: vi.fn(),
    onMentionRemoved: vi.fn(),
    onNavigate: vi.fn(),
    onQueryChange: vi.fn(),
    onSkillRemoved: vi.fn(),
    onValueChange: vi.fn(),
    submit: vi.fn(),
  };
  const props = (overrides: Harness = {}): MentionEditorProps => {
    const merged = { ...options, ...overrides };
    const ctx: InputMessageEditorContext = {
      ariaLabel: 'Message',
      disabled: false,
      maxRows: 6,
      metrics,
      minRows: 3,
      ...(merged.acceptPlaceholder === undefined
        ? {}
        : { acceptPlaceholder: merged.acceptPlaceholder }),
      onValueChange: spies.onValueChange,
      placeholder: merged.placeholder ?? 'Ask',
      submit: spies.submit,
      value: merged.value ?? '',
    };
    return {
      chipPaths: merged.chipPaths ?? [],
      ctx,
      listbox: {
        activeOptionId: merged.listboxOpen ? 'box-option-0' : undefined,
        controls: merged.listboxOpen ? 'box' : undefined,
        onAccept: spies.onAccept,
        onDismiss: spies.onDismiss,
        onNavigate: spies.onNavigate,
        open: merged.listboxOpen ?? false,
      },
      onMentionAdded: spies.onMentionAdded,
      onMentionRemoved: spies.onMentionRemoved,
      onQueryChange: spies.onQueryChange,
      onSkillRemoved: spies.onSkillRemoved,
      skill: merged.skill ?? null,
      skillsEnabled: merged.skillsEnabled ?? false,
      statuses: merged.statuses ?? {},
    };
  };
  const ref: { current: MentionEditorHandle | null } = { current: null };
  const view = render(<MentionEditor {...props()} ref={ref} />);
  const field = screen.getByRole('textbox', { name: 'Message' });
  const editor = editorOf(field);
  return {
    editor,
    field,
    ref,
    rerender: (overrides: Harness) =>
      view.rerender(<MentionEditor {...props(overrides)} ref={ref} />),
    view,
    ...spies,
  };
}

describe('mention editor', () => {
  it('finds @path runs in plain text at word boundaries only', () => {
    expect(chipRuns('See @docs/a.md and @docs/a.md.bak, x@docs/a.md', ['docs/a.md'])).toEqual([
      { from: 4, path: 'docs/a.md', to: 14 },
    ]);
  });

  it('takes the placeholder as the draft on Tab when it is a request', () => {
    const { editor, field, onValueChange } = harness({
      acceptPlaceholder: true,
      placeholder: 'Build a wiki for docs',
    });
    pressKey(field, 'Tab');
    expect(editor.state.doc.toString()).toBe('Build a wiki for docs');
    expect(onValueChange).toHaveBeenLastCalledWith('Build a wiki for docs');
    // Once there is a draft, Tab is Tab again.
    pressKey(field, 'Tab');
    expect(editor.state.doc.toString()).toBe('Build a wiki for docs');
  });

  it('leaves a hint placeholder alone on Tab', () => {
    const { editor, field, onValueChange } = harness({
      acceptPlaceholder: false,
      placeholder: 'Message your agent…',
    });
    pressKey(field, 'Tab');
    expect(editor.state.doc.toString()).toBe('');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('inserts a chip that serializes back to @path and binds it', () => {
    const { editor, field, onMentionAdded, onValueChange, ref } = harness();
    act(() => {
      editor.dispatch({ changes: { from: 0, insert: 'Read @no' }, selection: { anchor: 8 } });
    });
    act(() => ref.current?.insertMention('notes.md'));
    expect(serialize(editor.state)).toBe('Read @notes.md ');
    expect(onValueChange).toHaveBeenLastCalledWith('Read @notes.md ');
    expect(onMentionAdded).toHaveBeenCalledWith('notes.md');
    const chip = field.querySelector('[data-mention="notes.md"]'); // dom-contract: CodeMirror WidgetType in the editor's text layer
    expect(chip?.textContent).toBe('notes.md (file mention: notes.md)');
    expect(editor.state.doc.toString()).toBe('Read ￼ ');
  });

  it('re-chips known paths in an externally supplied value and reports removals', () => {
    const { editor, field, onMentionRemoved, rerender } = harness();
    rerender({
      chipPaths: ['docs/a.md', 'b.pdf'],
      statuses: { 'b.pdf': 'preparing' },
      value: 'Compare @docs/a.md with @b.pdf now',
    });
    expect(serialize(editor.state)).toBe('Compare @docs/a.md with @b.pdf now');
    // The mention/skill chips below are CodeMirror WidgetType instances rendered into the
    // editor's own text layer; their DOM shape is the contract, not an accessible query surface.
    expect(field.querySelectorAll('[data-mention]')).toHaveLength(2); // dom-contract: see comment above
    expect(field.querySelector('[data-mention="b.pdf"] [title="Preparing"]')).not.toBeNull(); // dom-contract: see comment above
    expect(field.querySelector('[data-mention="b.pdf"]')?.textContent).toContain('preparing'); // dom-contract: see comment above

    // Backspace with the caret right after the second chip deletes it whole.
    const doc = editor.state.doc.toString();
    const at = doc.indexOf('￼', doc.indexOf('￼') + 1) + 1;
    act(() => editor.dispatch({ selection: { anchor: at } }));
    pressKey(field, 'Backspace');
    expect(serialize(editor.state)).toBe('Compare @docs/a.md with  now');
    expect(onMentionRemoved).toHaveBeenCalledWith('b.pdf');
  });

  it('routes Enter to the listbox while open and to submit otherwise', () => {
    const { field, onAccept, rerender, submit } = harness();
    pressKey(field, 'Enter');
    expect(submit).toHaveBeenCalledTimes(1);
    // Alt+Enter keeps a mid-response follow-up queued for after the reply.
    pressKey(field, 'Enter', { altKey: true });
    expect(submit).toHaveBeenLastCalledWith({ queue: true });
    expect(submit).toHaveBeenCalledTimes(2);
    rerender({ listboxOpen: true });
    pressKey(field, 'Enter');
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(2);
    // The open popup is announced through the controlled listbox and the
    // active option; `aria-expanded` is not allowed on a textbox and axe
    // scores the composer's story for exactly that.
    expect(field.getAttribute('aria-expanded')).toBeNull();
    expect(field.getAttribute('aria-controls')).toBe('box');
  });

  it('opens a skill query only where the runtime runs skills', () => {
    const disabled = harness();
    act(() => {
      disabled.editor.dispatch({ changes: { from: 0, insert: '/rev' }, selection: { anchor: 4 } });
    });
    expect(disabled.onQueryChange).toHaveBeenLastCalledWith(null);
    cleanup();

    const enabled = harness({ skillsEnabled: true });
    act(() => {
      enabled.editor.dispatch({ changes: { from: 0, insert: '/rev' }, selection: { anchor: 4 } });
    });
    expect(enabled.onQueryChange).toHaveBeenLastCalledWith({
      from: 0,
      kind: 'skill',
      query: 'rev',
    });
  });

  it('places a picked skill as a leading token that stays out of the draft', () => {
    const test = harness({ skillsEnabled: true });
    act(() => {
      test.editor.dispatch({
        changes: { from: 0, insert: 'check /rev' },
        selection: { anchor: 10 },
      });
    });
    act(() => test.ref.current?.insertSkill('review'));

    expect(test.editor.state.doc.toString()).toBe('￼ check ');
    expect(serialize(test.editor.state)).toBe('check ');
    expect(test.onValueChange).toHaveBeenLastCalledWith('check ');
    const skillChip = test.field.querySelector('[data-skill="review"]'); // dom-contract: CodeMirror WidgetType in the editor's text layer
    expect(skillChip?.textContent).toBe('/review (selected skill: review)');
  });

  it('keeps the token through an external value replace and reports its deletion', () => {
    const test = harness({ skill: { id: 'review', label: 'review' }, skillsEnabled: true });
    expect(test.field.querySelector('[data-skill="review"]')).not.toBeNull(); // dom-contract: CodeMirror WidgetType in the editor's text layer

    test.rerender({
      skill: { id: 'review', label: 'review' },
      skillsEnabled: true,
      value: 'Check the intro',
    });
    expect(test.editor.state.doc.toString()).toBe('￼ Check the intro');
    expect(serialize(test.editor.state)).toBe('Check the intro');

    act(() => test.editor.dispatch({ selection: { anchor: 1 } }));
    pressKey(test.field, 'Backspace');
    expect(test.field.querySelector('[data-skill]')).toBeNull(); // dom-contract: CodeMirror WidgetType in the editor's text layer
    expect(test.onSkillRemoved).toHaveBeenCalledTimes(1);
    expect(serialize(test.editor.state)).toBe('Check the intro');
  });

  it('holds Enter while a skill query lists nothing', () => {
    const test = harness({ skillsEnabled: true });
    test.onAccept.mockReturnValue(true);
    test.rerender({ listboxOpen: true, skillsEnabled: true });
    act(() => {
      test.editor.dispatch({ changes: { from: 0, insert: '/zzz' }, selection: { anchor: 4 } });
    });
    pressKey(test.field, 'Enter');
    expect(test.onAccept).toHaveBeenCalledTimes(1);
    expect(test.submit).not.toHaveBeenCalled();
  });
});
