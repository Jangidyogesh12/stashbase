/**
 * Keep Markdown serialization choices owned by the source file. CodeMirror
 * represents line breaks as LF internally, so an edited CRLF document needs
 * its original convention restored at the filesystem boundary.
 *
 * Prose takes the file's dominant line ending throughout. A table cannot:
 * spreadsheet apps end records with CRLF and break lines inside a quoted
 * cell with LF, so `keepUnchangedLineEndings` gives every line the edit left
 * alone its own ending back, and only edited lines take the dominant one.
 */
export function preserveTextSourceFormat(
  previous: string,
  next: string,
  options: { keepUnchangedLineEndings?: boolean } = {},
): string {
  const hasBom = previous.length === 0 ? next.startsWith('\uFEFF') : previous.startsWith('\uFEFF');
  const content = next.startsWith('\uFEFF') ? next.slice(1) : next;
  const lineEnding = dominantLineEnding(previous);
  // A file of lone CRs has no dominant LF or CRLF, but its rows still keep theirs.
  const serialized = options.keepUnchangedLineEndings && /[\r\n]/.test(previous)
    ? restoreLineEndings(previous.startsWith('\uFEFF') ? previous.slice(1) : previous, content, lineEnding ?? '\r')
    : !lineEnding
      ? content
      : content.replace(/\r\n|\r|\n/g, lineEnding);
  return (hasBom ? '\uFEFF' : '') + serialized;
}

function dominantLineEnding(content: string): '\n' | '\r\n' | null {
  const crlf = (content.match(/\r\n/g) ?? []).length;
  const lf = (content.match(/(?<!\r)\n/g) ?? []).length;
  if (crlf === 0 && lf === 0) return null;
  return crlf > lf ? '\r\n' : '\n';
}

/** Give every line the edit left alone its old ending back; an inserted or
 *  rewritten line takes `fallback`. Lines are matched as a diff would: a
 *  common start and end, then lines that occur once on each side, in order,
 *  as anchors between which the same is repeated (patience diff). Blank and
 *  repeated lines match only beside an anchor or the ends, never by guess. */
function restoreLineEndings(previous: string, next: string, fallback: string): string {
  const old = previous.split(/(\r\n|\r|\n)/);
  const oldLines: string[] = [];
  const oldEndings: string[] = [];
  for (let i = 0; i < old.length; i += 2) {
    oldLines.push(old[i] ?? '');
    oldEndings.push(old[i + 1] ?? '');
  }
  const lines = next.split(/\r\n|\r|\n/);
  const matched = matchLines(oldLines, lines);
  let result = '';
  for (let i = 0; i < lines.length; i += 1) {
    result += lines[i];
    if (i === lines.length - 1) break;
    const from = matched[i] ?? -1;
    result += (from >= 0 ? oldEndings[from] : '') || fallback;
  }
  return result;
}

const MATCH_BUDGET = 4_000_000;

/** For each new line, the index of the old line it is, or -1. */
function matchLines(oldLines: readonly string[], lines: readonly string[]): Int32Array {
  const matched = new Int32Array(lines.length).fill(-1);
  const ranges: Array<[number, number, number, number]> = [[0, oldLines.length, 0, lines.length]];
  // Anchoring repeats over shrinking ranges; a pathological pair of texts
  // could make that quadratic, so past this many lines examined the rest is
  // treated as rewritten and takes the fallback ending.
  let budget = MATCH_BUDGET;
  while (ranges.length > 0) {
    let [oldStart, oldEnd, start, end] = ranges.pop()!;
    while (oldStart < oldEnd && start < end && oldLines[oldStart] === lines[start]) {
      matched[start++] = oldStart++;
    }
    while (oldStart < oldEnd && start < end && oldLines[oldEnd - 1] === lines[end - 1]) {
      matched[--end] = --oldEnd;
    }
    if (oldStart >= oldEnd || start >= end) continue;
    budget -= oldEnd - oldStart + end - start;
    if (budget < 0) break;
    const anchors = uniqueAnchors(oldLines, oldStart, oldEnd, lines, start, end);
    let previousOld = oldStart;
    let previousNew = start;
    for (const [oldIndex, newIndex] of anchors) {
      matched[newIndex] = oldIndex;
      ranges.push([previousOld, oldIndex, previousNew, newIndex]);
      previousOld = oldIndex + 1;
      previousNew = newIndex + 1;
    }
    if (anchors.length > 0) ranges.push([previousOld, oldEnd, previousNew, end]);
  }
  return matched;
}

/** Lines found exactly once in each range, as (old, new) pairs forming the
 *  longest run that keeps both orders. */
function uniqueAnchors(
  oldLines: readonly string[], oldStart: number, oldEnd: number,
  lines: readonly string[], start: number, end: number,
): Array<[number, number]> {
  const counts = new Map<string, { old: number; oldIndex: number; next: number; newIndex: number }>();
  for (let i = oldStart; i < oldEnd; i += 1) {
    const entry = counts.get(oldLines[i]!) ?? { old: 0, oldIndex: -1, next: 0, newIndex: -1 };
    entry.old += 1;
    entry.oldIndex = i;
    counts.set(oldLines[i]!, entry);
  }
  for (let i = start; i < end; i += 1) {
    const entry = counts.get(lines[i]!);
    if (!entry) continue;
    entry.next += 1;
    entry.newIndex = i;
  }
  const pairs: Array<[number, number]> = [];
  for (const entry of counts.values()) {
    if (entry.old === 1 && entry.next === 1) pairs.push([entry.oldIndex, entry.newIndex]);
  }
  pairs.sort((a, b) => a[1] - b[1]);
  // Longest increasing run of old indexes, by patience sorting.
  const tails: number[] = [];
  const previous = new Int32Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (pairs[tails[middle]!]![0] < pairs[i]![0]) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[i] = tails[low - 1]!;
    tails[low] = i;
  }
  const run: Array<[number, number]> = [];
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = previous[i]!) run.push(pairs[i]!);
  return run.reverse();
}
