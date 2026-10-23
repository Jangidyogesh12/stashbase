import { EditorState, type StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { ContextStatus } from '@/features/agent/domain/context';
import { stubMatchMedia } from '@/test/dom';

import {
  addMention,
  MENTION,
  mentionField,
  setStatuses,
  statusField,
  type MentionEffect,
} from './mention-markers';
import { mentionDecorations } from './mention-widgets';

const views: EditorView[] = [];

/** A document of `count` markers, each one the atomic placeholder character
 *  the widgets replace, separated by a space. */
function markerDoc(count: number): string {
  return Array.from({ length: count }, () => MENTION).join(' ');
}

/** A mention's glyph is drawn by a React root of its own, so the view is
 *  built inside `act`, which lets that root finish before the test reads. */
function createView(doc: string, effects: StateEffect<MentionEffect>[] = []): EditorView {
  const parent = document.createElement('div');
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [mentionField, statusField, mentionDecorations],
    }),
  });
  views.push(view);
  if (effects.length > 0) act(() => view.dispatch({ effects }));
  return view;
}

function fileMarker(from: number, path: string, fresh = false): StateEffect<MentionEffect> {
  return addMention.of({ fresh, from, kind: 'file', path });
}

/** The chips CodeMirror rendered, read out of the editor's own text layer. */
function chip(view: EditorView, selector: string): HTMLElement | null {
  return view.dom.querySelector<HTMLElement>(selector); // dom-contract: CodeMirror WidgetType in the editor's text layer
}

function chipCount(view: EditorView, selector: string): number {
  return view.dom.querySelectorAll(selector).length; // dom-contract: CodeMirror WidgetType in the editor's text layer
}

/** happy-dom ships no Web Animations API, so the one call `popIn` makes is
 *  installed here and taken away again afterwards. */
function stubAnimate(): ReturnType<typeof vi.fn> {
  const animate = vi.fn();
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
  return animate;
}

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
  Reflect.deleteProperty(Element.prototype, 'animate');
  vi.unstubAllGlobals();
});

describe('mention chips', () => {
  it('names a ready mention by its file and carries the full path in the text layer', () => {
    const view = createView(markerDoc(1), [fileMarker(0, 'docs/notes.md')]);

    const mention = chip(view, '[data-mention="docs/notes.md"]');
    expect(mention?.title).toBe('docs/notes.md');
    expect(mention?.textContent).toBe('notes.md (file mention: docs/notes.md)');
    // The chip carries no role of its own, so the file glyph is aria-hidden by design.
    expect(mention?.querySelector('svg[aria-hidden="true"]')).not.toBeNull(); // dom-contract: see comment above
    expect(chip(view, '[data-mention] [title]')).toBeNull();
  });

  it('marks a mention that is not ready with a titled dot and says so in the text layer', () => {
    const view = createView(markerDoc(1), [fileMarker(0, 'paper.pdf')]);
    view.dispatch({ effects: setStatuses.of({ 'paper.pdf': 'preparing' }) });

    expect(chip(view, '[data-mention="paper.pdf"] [title="Preparing"]')).not.toBeNull();
    expect(chip(view, '[data-mention="paper.pdf"]')?.textContent).toBe(
      'paper.pdf (file mention: paper.pdf, preparing)',
    );
  });

  it('gives every non-ready state its own word', () => {
    const statuses: ContextStatus[] = ['blocked', 'failed', 'preparing', 'stale'];
    const words = statuses.map((status) => {
      const view = createView(markerDoc(1), [fileMarker(0, 'a.md')]);
      view.dispatch({ effects: setStatuses.of({ 'a.md': status }) });
      return chip(view, '[data-mention="a.md"] span[title]')?.title;
    });

    expect(words).toEqual(['Blocked', 'Failed', 'Preparing', 'Stale']);
  });

  it('shows a skill marker as its own token rather than a file mention', () => {
    const view = createView(markerDoc(1), [
      addMention.of({ fresh: false, from: 0, kind: 'skill', path: 'review' }),
    ]);

    expect(chip(view, '[data-skill="review"]')?.textContent).toBe(
      '/review (selected skill: review)',
    );
    expect(chipCount(view, '[data-mention]')).toBe(0);
  });

  it('draws one chip per marker and nothing for a document that carries none', () => {
    const many = createView(markerDoc(2), [fileMarker(0, 'a.md'), fileMarker(2, 'b.md')]);
    expect(chipCount(many, '[data-mention]')).toBe(2);

    const plain = createView('no markers here');
    expect(chipCount(plain, '[data-mention]')).toBe(0);
  });
});

describe('mention chip reuse', () => {
  it('keeps the rendered chip across an edit that changes nothing about it', () => {
    const view = createView(`${MENTION} tail`, [fileMarker(0, 'a.md')]);
    const before = chip(view, '[data-mention="a.md"]');
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' more' } });

    expect(chip(view, '[data-mention="a.md"]')).toBe(before);
  });

  it('redraws the chip when the status behind it moves', () => {
    const view = createView(markerDoc(1), [fileMarker(0, 'a.md')]);
    const before = chip(view, '[data-mention="a.md"]');
    view.dispatch({ effects: setStatuses.of({ 'a.md': 'stale' }) });

    const after = chip(view, '[data-mention="a.md"]');
    expect(after).not.toBe(before);
    expect(after?.textContent).toContain('stale');
  });
});

describe('mention chip entrance', () => {
  it('pops a freshly picked chip in and leaves a restored one alone', () => {
    const animate = stubAnimate();
    createView(markerDoc(1), [fileMarker(0, 'a.md', true)]);
    expect(animate).toHaveBeenCalledTimes(1);

    animate.mockClear();
    createView(markerDoc(1), [fileMarker(0, 'a.md')]);
    expect(animate).not.toHaveBeenCalled();
  });

  it('pops a freshly armed skill token in too', () => {
    const animate = stubAnimate();
    createView(markerDoc(1), [
      addMention.of({ fresh: true, from: 0, kind: 'skill', path: 'review' }),
    ]);

    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('stays still for a reader who asked for reduced motion', () => {
    const animate = stubAnimate();
    stubMatchMedia(true);
    createView(markerDoc(1), [fileMarker(0, 'a.md', true)]);

    expect(animate).not.toHaveBeenCalled();
  });
});
