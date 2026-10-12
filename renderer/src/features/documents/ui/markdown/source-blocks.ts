/**
 * Writes a Markdown document back with the source text of every top-level
 * block the reader did not edit.
 *
 * Milkdown's serializer normalizes what it writes: bullets become `*` and
 * loose, `---` becomes `***`, setext headings become ATX, plain asterisks gain
 * escapes, and reference definitions are dropped. Serializing the whole
 * document on save therefore rewrote, and could lose, parts of a file nobody
 * touched. Here each top-level block of the editor document is paired with its
 * slice of the source it was opened from. ProseMirror keeps an unedited node as
 * the same object across edits, so such a block is written as its original
 * slice, and two adjacent ones keep the original text between them. Only edited
 * or new blocks are serialized, each cached by node, which also keeps a save
 * from costing the length of the document.
 */
import type { Node } from '@milkdown/kit/prose/model';

/** The part of an mdast node this module reads. */
export interface SourceNode {
  type: string;
  value?: string;
  children?: SourceNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** The source a document was opened from, keyed by the nodes it parsed into. */
export interface SourceSnapshot {
  /** Each paired node's index in `texts`. */
  index: Map<Node, number>;
  texts: string[];
  /** `gaps[i]` is the source before block `i`; `gaps[texts.length]` follows the last. */
  gaps: string[];
  /** The reference definitions inside each gap, which the editor does not hold. */
  definitions: string[][];
}

const LISTS = new Set(['bullet_list', 'ordered_list']);
/** Whitespace holding a blank line: a separator no block can run across. */
const BLANK_SEPARATOR = /^[ \t]*\n[ \t]*\n\s*$/u;

function sourceText(node: SourceNode): string {
  return (node.value ?? '') + (node.children ?? []).map(sourceText).join('');
}

const comparable = (text: string) => text.replace(/\s+/gu, '');

/**
 * Pairs the top-level blocks of `doc` with their slices of `source`, given the
 * mdast `root` the editor parsed `source` into and the reference `definitions`
 * that parse resolved away. Answers null when the two do not line up block for
 * block.
 */
export function mapSourceBlocks(
  source: string,
  { root, definitions: references }: { root: SourceNode; definitions: SourceNode[] },
  doc: Node,
): SourceSnapshot | null {
  const blocks = (root.children ?? []).filter((child) => child.type !== 'definition');
  if (blocks.length !== doc.childCount) return null;
  const index = new Map<Node, number>();
  const texts: string[] = [];
  const gaps: string[] = [];
  const definitions: string[][] = blocks.map(() => []).concat([[]]);
  const starts: number[] = [];
  let previousEnd = 0;
  for (const [i, block] of blocks.entries()) {
    const node = doc.child(i);
    const start = block.position?.start.offset;
    const end = block.position?.end.offset;
    if (start === undefined || end === undefined || start < previousEnd) return null;
    gaps[i] = source.slice(previousEnd, start);
    texts[i] = source.slice(start, end);
    starts[i] = start;
    previousEnd = end;
    // A block whose text differs from the node it parsed into is written by
    // the serializer; pairing it would put another block's words on disk.
    if (comparable(node.textContent) === comparable(sourceText(block))) index.set(node, i);
  }
  gaps[blocks.length] = source.slice(previousEnd);
  for (const child of references) {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (start === undefined || end === undefined) return null;
    const gap = starts.findIndex((blockStart) => blockStart > start);
    definitions[gap === -1 ? blocks.length : gap]?.push(source.slice(start, end));
  }
  return { index, texts, gaps, definitions };
}

/**
 * The Markdown for `doc`: paired blocks from `snapshot`, every other block from
 * `serializeBlock`. Answers null when two adjacent lists of one kind would be
 * joined by a blank line alone, which reads back as a single list; the caller
 * then serializes the whole document instead.
 */
export function assembleSource(
  snapshot: SourceSnapshot,
  doc: Node,
  serializeBlock: (node: Node) => string,
): string | null {
  const { definitions, gaps, index, texts } = snapshot;
  const kept = new Set<number>();
  const keep = (gap: number) => {
    kept.add(gap);
    return gaps[gap] ?? '';
  };
  /** The original spacing at `gap` when it still separates blocks safely. */
  const spacing = (gap: number | null) => {
    const original = gap === null ? undefined : gaps[gap];
    const holdsDefinitions = gap !== null && (definitions[gap]?.length ?? 0) > 0;
    return original !== undefined && BLANK_SEPARATOR.test(original) && !holdsDefinitions
      ? original
      : '\n\n';
  };
  let out = '';
  let previous: number | null = null;
  let previousType: string | null = null;
  let started = false;
  for (let j = 0; j < doc.childCount; j += 1) {
    const node = doc.child(j);
    const paired = index.get(node);
    const text = paired === undefined ? serializeBlock(node) : (texts[paired] ?? '');
    // An empty block, such as the paragraph the editor keeps at the end, writes
    // nothing and leaves the spacing between the blocks around it alone.
    if (paired === undefined && text === '') continue;
    const adjacent = paired !== undefined && paired === (previous ?? -1) + 1;
    if (started && !adjacent && LISTS.has(node.type.name) && node.type.name === previousType)
      return null;
    if (!started) out += paired === 0 ? keep(0) : '';
    else if (adjacent) out += keep(paired);
    // An edited block keeps the spacing the block it most likely replaced had.
    else out += spacing(paired ?? (previous === null ? null : previous + 1));
    out += text;
    started = true;
    previous = paired ?? null;
    previousType = node.type.name;
  }
  const end = texts.length;
  const ending = previous === end - 1 && end > 0 ? keep(end) : '\n';
  // Reference definitions live between blocks; one whose text was not kept
  // above is still written, so no link loses its target.
  const orphaned = definitions.flatMap((entries, gap) => (kept.has(gap) ? [] : entries));
  if (orphaned.length === 0) return out + ending;
  return `${out.trimEnd()}\n\n${orphaned.join('\n')}\n`;
}
