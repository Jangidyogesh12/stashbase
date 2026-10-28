import { parseDocument } from 'yaml';

const OPENING_DELIMITER = /^(?:\uFEFF)?---[\t ]*(?:\r\n?|\n)/u;
const CLOSING_DELIMITER = /^(?:---|\.\.\.)[\t ]*(?:\r\n?|\n|$)/gmu;

export interface MarkdownFrontmatter {
  body: string;
  source: string;
}

/** Keep metadata Milkdown does not model outside its serialized document body. */
export function splitLeadingYamlFrontmatter(markdown: string): MarkdownFrontmatter {
  const opening = OPENING_DELIMITER.exec(markdown);
  if (!opening) return { body: markdown, source: '' };

  CLOSING_DELIMITER.lastIndex = opening[0].length;
  const closing = CLOSING_DELIMITER.exec(markdown);
  if (!closing) return { body: markdown, source: '' };

  const parsed = parseDocument(markdown.slice(opening[0].length, closing.index));
  if (parsed.errors.length > 0) return { body: markdown, source: '' };
  return {
    body: markdown.slice(CLOSING_DELIMITER.lastIndex),
    source: markdown.slice(0, CLOSING_DELIMITER.lastIndex),
  };
}
