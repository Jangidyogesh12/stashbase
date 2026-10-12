import { ExactSearchError, type ExactSearchPort } from '@/features/retrieval/application/ports';
import {
  exactSearchFileId,
  type ExactSearchResult,
} from '@/features/retrieval/domain/exact-search';
import { request } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import {
  exactSearchFailureSchema,
  exactSearchRequestSchema,
  exactSearchResponseSchema,
  type ExactSearchResponseWire,
} from '@/protocols/http/search';

function mapResult(result: ExactSearchResponseWire): ExactSearchResult {
  return {
    files: result.files.map((file) => {
      const source = { folderPath: file.folder, path: file.path };
      return {
        id: exactSearchFileId(source),
        matches: file.matches.map((match) => ({
          line: match.line,
          ...(match.pdfPage === undefined ? {} : { pdfPage: match.pdfPage }),
          ranges: match.ranges.map(([start, end]) => ({ end, start })),
          text: match.text,
        })),
        source,
        totalMatches: file.totalMatches,
      };
    }),
    totalMatches: result.totalMatches,
    truncated: result.truncated,
  };
}

export function createExactSearchAdapter(client: HttpClient): ExactSearchPort {
  return {
    async search(search, signal) {
      const body = exactSearchRequestSchema.parse({
        case_strict: search.caseSensitive,
        folder: search.folderPath,
        query: search.query,
        whole_word: search.wholeWord,
      });
      return mapResult(
        await request(client, {
          body,
          error: ExactSearchError,
          failureSchema: exactSearchFailureSchema,
          method: 'POST',
          path: '/api/project/keyword-search',
          schema: exactSearchResponseSchema,
          signal,
        }),
      );
    },
  };
}
