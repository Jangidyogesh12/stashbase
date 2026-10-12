import { describe, expect, it } from 'vite-plus/test';

import { EmbedderError } from './embedder-port';
import { failureMessage, settingsFailure } from './failure-messages';
import { AgentRuntimeError, SettingsError } from './ports';

describe('settings failures', () => {
  it('gives every kind one sentence, so no call site invents its own', () => {
    expect(failureMessage('unavailable')).toBe('StashBase is unavailable.');
    expect(failureMessage('unauthorized')).toBe('This window can no longer change that setting.');
    expect(failureMessage('scope-lost')).toBe(
      'That setting is no longer available in this window.',
    );
    expect(failureMessage('invalid-response')).toBe('StashBase returned an unexpected response.');
    expect(failureMessage('invalid-request')).toBe('StashBase could not accept that change.');
    expect(failureMessage('rejected')).toBe('StashBase could not accept that.');
  });

  it('separates what the reader can fix from what they cannot', () => {
    expect(settingsFailure(new SettingsError('invalid-request', 'raw')).tone).toBe('input');
    expect(settingsFailure(new EmbedderError('rejected', 'raw')).tone).toBe('input');
    expect(settingsFailure(new AgentRuntimeError('unavailable', 'raw')).tone).toBe('capability');
    expect(settingsFailure(new AgentRuntimeError('unauthorized', 'raw')).tone).toBe('capability');
  });

  it('reads a rejected key differently from an unreachable server', () => {
    expect(settingsFailure(new EmbedderError('rejected', 'Invalid API key.'))).toEqual({
      message: failureMessage('rejected'),
      tone: 'input',
    });
    expect(settingsFailure(new EmbedderError('unavailable', 'raw transport detail'))).toEqual({
      message: failureMessage('unavailable'),
      tone: 'capability',
    });
  });

  it('never repeats the sentence a failure was thrown with', () => {
    expect(settingsFailure(new SettingsError('invalid-request', 'HTTP 422 unprocessable'))).toEqual(
      {
        message: failureMessage('invalid-request'),
        tone: 'input',
      },
    );
    expect(settingsFailure(new AgentRuntimeError('scope-lost', 'folder grant expired'))).toEqual({
      message: failureMessage('scope-lost'),
      tone: 'capability',
    });
  });

  it('treats anything that is not a settings failure as an unreachable capability', () => {
    expect(settingsFailure(new Error('boom'))).toEqual({
      message: failureMessage('unavailable'),
      tone: 'capability',
    });
    expect(settingsFailure('nonsense')).toEqual({
      message: failureMessage('unavailable'),
      tone: 'capability',
    });
  });
});
