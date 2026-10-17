import { describe, expect, it } from 'vite-plus/test';

import { embedderState, keyedEmbedderState } from '@/test/fakes/settings';

import { embedderSummary, keyIsActive } from './embedder';

describe('embedder domain', () => {
  it('uses key presence for both providers without an independent authorization state', () => {
    for (const provider of ['openai', 'openrouter'] as const) {
      expect(keyIsActive(embedderState({ provider }))).toBe(false);
      expect(keyIsActive(keyedEmbedderState({ provider }))).toBe(true);
    }
  });

  it('names the configured provider without claiming connectivity', () => {
    expect(embedderSummary(embedderState())).toBe('Off · Needs an API key');
    expect(embedderSummary(keyedEmbedderState({ provider: 'openrouter' }))).toBe('On · OpenRouter');
  });
});
