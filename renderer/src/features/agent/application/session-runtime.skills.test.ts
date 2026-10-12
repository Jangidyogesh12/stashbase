/** The skill catalog the runtime reports, and what arming one costs: a skill
 *  applies to a single turn, survives a retry of that turn, and a catalog the
 *  runtime could not read disarms rather than announcing itself. */
import { describe, expect, it } from 'vite-plus/test';

import { createAgentSessionRuntime } from './session-runtime';
import { harness } from './session-runtime.harness';

describe('AgentSessionRuntime skills', () => {
  it('arms a catalog skill for one turn and resends it on retry', async () => {
    const test = harness();
    const runtime = createAgentSessionRuntime({
      agent: 'claude',
      id: 'chat-1',
      port: test.port,
      scheduler: test.scheduler,
      scope: { kind: 'folder', path: '/project/Research' },
    });
    test.listeners[0]?.onEvent({
      error: null,
      kind: 'skills',
      skills: [{ id: 'review', label: 'review', description: 'Review the draft' }],
      state: 'available',
    });
    test.listeners[0]?.onEvent({ kind: 'ready' });
    expect(runtime.store.getState().skillCatalog).toEqual({
      kind: 'available',
      skills: [{ id: 'review', label: 'review', description: 'Review the draft' }],
    });

    runtime.refreshSkills();
    expect(test.sent.at(-1)).toMatchObject({ kind: 'refresh-skills' });

    runtime.setSkill('review');
    expect(runtime.store.getState().skill).toBe('review');
    await expect(runtime.sendPrompt('')).resolves.toEqual({ ok: true });
    expect(test.sent.at(-1)).toMatchObject({ kind: 'prompt', skill: 'review', text: '' });
    expect(runtime.store.getState().skill).toBe(null);
    expect(runtime.store.getState().transcript.at(-1)).toMatchObject({
      kind: 'user',
      text: '/review',
    });

    test.listeners[0]?.onEvent({ kind: 'failed', message: 'Rate limited.' });
    const failure = runtime.store.getState().transcript.find((block) => block.kind === 'error');
    expect(runtime.retry(failure?.id ?? '')).toBe(true);
    expect(test.sent.at(-1)).toMatchObject({ kind: 'prompt', skill: 'review', text: '' });
  });

  it('disarms a skill the refreshed catalog no longer offers', async () => {
    const test = harness();
    const runtime = createAgentSessionRuntime({
      agent: 'claude',
      id: 'chat-1',
      port: test.port,
      scheduler: test.scheduler,
      scope: { kind: 'folder', path: '/project/Research' },
    });
    test.listeners[0]?.onEvent({
      error: null,
      kind: 'skills',
      skills: [{ id: 'review', label: 'review' }],
      state: 'available',
    });
    test.listeners[0]?.onEvent({ kind: 'ready' });
    runtime.setSkill('review');

    test.listeners[0]?.onEvent({
      error: 'Skill folder is unreadable.',
      kind: 'skills',
      skills: [],
      state: 'failed',
    });
    expect(runtime.store.getState().skill).toBe(null);
    expect(runtime.store.getState().skillCatalog).toEqual({
      kind: 'failed',
      message: 'Skill folder is unreadable.',
    });
    // A failed catalog is a picker state, not a transcript notice.
    expect(runtime.store.getState().transcript).toEqual([]);
    await expect(runtime.sendPrompt('')).resolves.toEqual({ ok: false, reason: 'empty' });
  });
});
