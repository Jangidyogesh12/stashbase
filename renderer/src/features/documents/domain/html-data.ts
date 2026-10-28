/** One explicitly addressed JSON resource, relative to its HTML document. */
import { applyEdits, modify } from 'jsonc-parser';

import { featureErrorClass } from '@/shared/domain/feature-error';
import type { SourceReference } from '@/shared/domain/source-reference';

import { addJsonChild, deleteJsonPath } from './json-edit';
import { analyzeJsonSource } from './json-source';

export const HtmlDataError = featureErrorClass<'rejected'>('HtmlDataError');

export function htmlDataSource(
  source: SourceReference,
  relativePath?: string,
): SourceReference | null {
  if (!/\.html?$/iu.test(source.path)) return null;
  if (relativePath !== undefined) {
    const relative = relativePath.replace(/^\.\//u, '');
    if (
      relative.length > 4096 ||
      !relative.startsWith('assets/') ||
      !/\.json$/iu.test(relative) ||
      /[\\?#%:\p{Cc}]/u.test(relative) ||
      relative.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new HtmlDataError(
        'rejected',
        'Use a relative JSON path inside this page’s assets folder.',
      );
    const slash = source.path.lastIndexOf('/');
    return { ...source, path: source.path.slice(0, slash + 1) + relative };
  }
  return { ...source, path: source.path.replace(/\.html?$/iu, '.json') };
}

export function parseHtmlData(content: string): unknown {
  const analysis = analyzeJsonSource(content);
  if (!analysis.available)
    throw new HtmlDataError('rejected', analysis.message.replace('Tree mode', 'Form data'));
  return JSON.parse(content.replace(/^\uFEFF/u, '')) as unknown;
}

/** Change only different values, preserving untouched JSON spelling and whitespace. */
export function updateHtmlData(source: string, content: string): string {
  const next = parseHtmlData(content);
  const before = parseHtmlData(source);
  const change = (path: (string | number)[], value: unknown) => {
    source =
      value === undefined
        ? deleteJsonPath(source, path)
        : applyEdits(source, modify(source, path, value, {}));
  };
  const visit = (old: unknown, value: unknown, path: (string | number)[]) => {
    if (old === value) return;
    if (old === undefined && path.length) {
      const key = path.at(-1);
      source = addJsonChild(
        source,
        path.slice(0, -1),
        JSON.stringify(value),
        typeof key === 'string' ? key : undefined,
      );
    } else if (Array.isArray(old) && Array.isArray(value)) {
      for (let i = old.length - 1; i >= value.length; i--) change([...path, i], undefined);
      value.forEach((item: unknown, i: number) => visit(old[i], item, [...path, i]));
    } else if (isObject(old) && isObject(value)) {
      for (const key of Object.keys(old)) {
        if (!Object.hasOwn(value, key)) change([...path, key], undefined);
      }
      for (const key of Object.keys(value))
        visit(Object.hasOwn(old, key) ? old[key] : undefined, value[key], [...path, key]);
    } else change(path, value);
  };
  visit(before, next, []);
  parseHtmlData(source);
  return source;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
