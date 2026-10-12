import { describe, expect, it } from 'vite-plus/test';

import { foldPdfText } from './find-controller';

describe('PDF Find text matching', () => {
  it('folds common PDF punctuation and spacing variants', () => {
    expect(foldPdfText('“Plan”\u00a0—\u200bready')).toBe('"Plan" - ready');
  });
});
