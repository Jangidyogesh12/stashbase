/** File-type categories the search surfaces can filter by. Shared
 *  vocabulary between the renderer (chips) and the server (extension
 *  mapping); the category → extension mapping itself stays in
 *  `server/format.ts` next to the other extension knowledge. */
export const SEARCH_TYPE_CATEGORIES = ['notes', 'data', 'pdf', 'image', 'docx'] as const;

export type SearchTypeCategory = (typeof SEARCH_TYPE_CATEGORIES)[number];

/** Stable HTTP/MCP vocabulary, also used by the renderer. These wire names
 * describe user intent; server algorithms are grep and hybrid. */
export const SEARCH_MODES = ['semantic', 'keyword'] as const;
export type RetrievalMode = 'grep' | 'hybrid';

export function toRetrievalMode(mode: SearchMode): RetrievalMode;
export function toRetrievalMode(mode: SearchMode | undefined): RetrievalMode | undefined;
export function toRetrievalMode(mode: SearchMode | undefined): RetrievalMode | undefined {
  return mode === undefined ? undefined : mode === 'keyword' ? 'grep' : 'hybrid';
}

export function toSearchMode(mode: RetrievalMode): SearchMode {
  return mode === 'grep' ? 'keyword' : 'semantic';
}

export type SearchMode = (typeof SEARCH_MODES)[number];

function isSearchTypeCategory(value: unknown): value is SearchTypeCategory {
  return typeof value === 'string' && (SEARCH_TYPE_CATEGORIES as readonly string[]).includes(value);
}

export const SEARCH_TYPES_VALIDATION_ERROR =
  `unknown search type; types must be an array containing only: ${SEARCH_TYPE_CATEGORIES.join(', ')}`;

export const SEARCH_MODE_VALIDATION_ERROR =
  `unknown search mode; mode must be one of: ${SEARCH_MODES.join(', ')}`;

/** Omission lets the server select a strategy from current key configuration.
 * Invalid input is null and must never become an automatic search. */
export function parseSearchMode(raw: unknown): SearchMode | undefined | null {
  if (raw == null) return undefined;
  const value = typeof raw === 'string' ? raw.trim() : raw;
  return typeof value === 'string' && (SEARCH_MODES as readonly string[]).includes(value)
    ? (value as SearchMode)
    : null;
}

/** Normalizes an optional transport value into the shared search vocabulary.
 *  Absent → empty list (no filter); malformed input or any unknown entry →
 *  null so each transport can return its native validation error envelope. */
export function parseSearchTypes(raw: unknown): SearchTypeCategory[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  const out: SearchTypeCategory[] = [];
  for (const entry of raw) {
    const value = typeof entry === 'string' ? entry.trim() : entry;
    if (!isSearchTypeCategory(value)) return null;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}
