/** The one Find match loop every text viewer searches with. */
import type { FindOptions } from './location';

export interface TextRange {
  from: number;
  to: number;
}

function isWordBoundary(text: string, index: number): boolean {
  const character = text[index];
  return character === undefined || !/[\p{L}\p{N}_]/u.test(character);
}

/** Non-overlapping occurrences of `query` in `text`, in order. A viewer that
 *  folds its text (PDF punctuation, for one) passes the folded pair in. */
export function findTextMatches(text: string, query: string, options: FindOptions): TextRange[] {
  if (!query) return [];
  const haystack = options.caseSensitive ? text : text.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const matches: TextRange[] = [];
  for (
    let from = haystack.indexOf(needle);
    from >= 0;
    from = haystack.indexOf(needle, from + Math.max(1, needle.length))
  ) {
    const to = from + needle.length;
    if (!options.wholeWord || (isWordBoundary(text, from - 1) && isWordBoundary(text, to))) {
      matches.push({ from, to });
    }
  }
  return matches;
}
