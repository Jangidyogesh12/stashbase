import { describe, expect, it } from 'vite-plus/test';

import { findTextMatches } from './find-text';

describe('Find text matching', () => {
  it('finds occurrences with case and whole-word options', () => {
    const malformed = '{"Alpha": 1, "alpha_beta": 2, "alpha":';
    expect(findTextMatches(malformed, 'alpha', { caseSensitive: false, wholeWord: false })).toEqual(
      [
        { from: 2, to: 7 },
        { from: 14, to: 19 },
        { from: 31, to: 36 },
      ],
    );
    expect(findTextMatches(malformed, 'alpha', { caseSensitive: false, wholeWord: true })).toEqual([
      { from: 2, to: 7 },
      { from: 31, to: 36 },
    ]);
    expect(
      findTextMatches('Plan planner PLAN', 'Plan', { caseSensitive: true, wholeWord: false }),
    ).toEqual([{ from: 0, to: 4 }]);
  });

  it('finds nothing for an empty query', () => {
    expect(findTextMatches('text', '', { caseSensitive: false, wholeWord: false })).toEqual([]);
  });
});
