/**
 * Source-preserving JSON mutations.
 *
 * Every edit is a splice into the original text at offsets the parse reported,
 * and the surrounding style — indentation, separator spacing, line endings —
 * is inferred from the container being edited, so a structural change never
 * reformats the rest of the file.
 */
import { parseTree, type Node, type ParseError } from 'jsonc-parser';

import { featureErrorClass, type FeatureError } from '@/shared/domain/feature-error';

import { analyzeJsonSource, formatJsonPath, type JsonPath } from './json-source';

/**
 * An edit this module refused, with the sentence the reader sees.
 *
 * These refusals name the key or path that could not be edited, which no
 * fixed line elsewhere could, so the wording is authored here rather than
 * selected by kind at the view. A rejection that is *not* one of these is a
 * bug, and the view says so instead of repeating it.
 */
export type JsonEditError = FeatureError<'rejected'>;
export const JsonEditError = featureErrorClass<'rejected'>('JsonEditError');

const refuse: (message: string) => never = (message) => {
  throw new JsonEditError('rejected', message);
};

export function deleteJsonPath(source: string, path: JsonPath): string {
  if (!path.length) refuse('The root value cannot be deleted.');
  const located = locate(source, path);
  const target = located.node.parent?.type === 'property' ? located.node.parent : located.node;
  const container = target.parent;
  const siblings = container?.children ?? [];
  const index = siblings.indexOf(target);
  if (!container || index < 0) refuse('Value no longer exists.');
  let from = target.offset;
  let to = target.offset + target.length;
  const nextSibling = siblings[index + 1];
  const previousSibling = siblings[index - 1];
  if (nextSibling) {
    to = nextSibling.offset;
  } else if (previousSibling) {
    from = previousSibling.offset + previousSibling.length;
  }
  return splice(source, from + located.bom, to - from, '');
}

export function addJsonChild(
  source: string,
  containerPath: JsonPath,
  rawValue: string,
  key?: string,
): string {
  const valueAnalysis = analyzeJsonSource(rawValue);
  if (!valueAnalysis.available) {
    refuse(`New value is not valid strict JSON: ${valueAnalysis.message}`);
  }
  const located = locate(source, containerPath);
  const container = located.node;
  if (container.type !== 'array' && container.type !== 'object') {
    refuse('Values can only be added to objects or arrays.');
  }
  if (container.type === 'object') {
    if (key === undefined) refuse('A property key is required.');
    if ((container.children ?? []).some((property) => property.children?.[0]?.value === key)) {
      refuse(`The key ${JSON.stringify(key)} already exists in this object.`);
    }
  }
  const raw = replacementWithoutBom(rawValue);
  const children = container.children ?? [];
  const close = container.offset + container.length - 1 + located.bom;
  const style = inferStyle(source, container, located.bom);
  const member = container.type === 'object' ? `${JSON.stringify(key)}${style.colon}${raw}` : raw;
  const last = children.at(-1);
  if (last === undefined) {
    if (style.multiline) {
      const open = container.offset + located.bom;
      const interior = source.slice(open + 1, close);
      const closingIndent = interior.slice(
        Math.max(interior.lastIndexOf('\n'), interior.lastIndexOf('\r')) + 1,
      );
      const childIndent =
        closingIndent === style.parentIndent
          ? style.childIndent
          : closingIndent + inferIndent(source);
      return splice(
        source,
        open + 1,
        interior.length,
        `${style.eol}${childIndent}${member}${style.eol}${closingIndent}`,
      );
    }
    return splice(source, close, 0, member);
  }
  const insertion = style.multiline
    ? `,${style.eol}${style.childIndent}${member}`
    : `${style.comma}${member}`;
  return splice(source, last.offset + located.bom + last.length, 0, insertion);
}

function locate(source: string, path: JsonPath): { bom: number; node: Node } {
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  const errors: ParseError[] = [];
  const root = parseTree(source.slice(bom), errors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (!root || errors.length) {
    refuse('The source is no longer valid JSON. Switch to Source mode.');
  }
  let node: Node | undefined = root;
  for (const part of path) {
    node =
      typeof part === 'number'
        ? node.children?.[part]
        : node.children?.find(
            (property) => property.type === 'property' && property.children?.[0]?.value === part,
          )?.children?.[1];
    if (!node) refuse(`Path ${formatJsonPath(path)} no longer exists.`);
  }
  return { bom, node };
}

function inferStyle(source: string, container: Node, bom: number) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const containerOffset = container.offset + bom;
  const containerRaw = source.slice(containerOffset, containerOffset + container.length);
  const multiline = /\r?\n/u.test(containerRaw);
  const parentIndent = lineIndentAt(source, containerOffset);
  const first = container.children?.[0];
  const childIndent = first
    ? lineIndentAt(source, first.offset + bom)
    : parentIndent + inferIndent(source);
  let colon = ': ';
  if (container.type === 'object' && first?.children?.[0] && first.children[1]) {
    colon = source.slice(
      first.children[0].offset + bom + first.children[0].length,
      first.children[1].offset + bom,
    );
  }
  const comma = containerRaw.includes(', ') ? ', ' : ',';
  return { childIndent, colon, comma, eol, multiline, parentIndent };
}

function inferIndent(source: string): string {
  return source.match(/\r?\n([\t ]+)\S/u)?.[1] ?? '  ';
}

function lineIndentAt(source: string, offset: number): string {
  const start = Math.max(source.lastIndexOf('\n', offset - 1) + 1, 0);
  return source.slice(start, offset).match(/^[\t ]*/u)?.[0] ?? '';
}

function replacementWithoutBom(value: string): string {
  return value.startsWith('\uFEFF') ? value.slice(1) : value;
}

function splice(source: string, offset: number, length: number, replacement: string): string {
  return source.slice(0, offset) + replacement + source.slice(offset + length);
}
