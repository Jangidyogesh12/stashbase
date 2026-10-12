import {
  SemanticSearchError,
  type SemanticSearchPort,
} from '@/features/retrieval/application/ports';
import {
  semanticHitId,
  semanticSnippet,
  type SemanticSearchResult,
} from '@/features/retrieval/domain/semantic-search';
import { request, type TransportFailure } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import {
  EMBEDDER_KEY_REQUIRED_CODE,
  semanticSearchFailureSchema,
  semanticSearchRequestSchema,
  semanticSearchResponseSchema,
  type SemanticSearchResponseWire,
} from '@/protocols/http/semantic-search';

function mapResult(result: SemanticSearchResponseWire): SemanticSearchResult {
  return {
    hits: result.hits.map((hit) => {
      const source = { folderPath: hit.folder, path: hit.path };
      return {
        chunkIndex: hit.chunkIndex,
        content: hit.content,
        ...(hit.endLine === undefined ? {} : { endLine: hit.endLine }),
        heading: hit.heading,
        id: semanticHitId(source, hit.chunkIndex),
        ...(hit.pdfPage === undefined ? {} : { pdfPage: hit.pdfPage }),
        score: hit.score,
        snippet: semanticSnippet(hit.content),
        source,
        ...(hit.startLine === undefined ? {} : { startLine: hit.startLine }),
      };
    }),
    truncated: result.truncated ?? false,
  };
}

/** Search-by-meaning refusal the shared ladder cannot see: no BYOK embedder
 *  is configured yet. */
function readinessFailure({
  response,
  serverMessage,
}: TransportFailure): SemanticSearchError | null {
  const failure = semanticSearchFailureSchema.safeParse(response.body);
  const cause = serverMessage === null ? undefined : { cause: new Error(serverMessage) };
  if (response.status === 412 || failure.data?.code === EMBEDDER_KEY_REQUIRED_CODE) {
    return new SemanticSearchError(
      'not-set-up',
      'To search by meaning, set it up in StashBase Settings.',
      cause,
    );
  }
  return null;
}

export function createSemanticSearchAdapter(client: HttpClient): SemanticSearchPort {
  return {
    async search(search, signal) {
      const body = semanticSearchRequestSchema.parse({
        folder: search.folderPath,
        mode: 'semantic',
        query: search.query,
        top_k: search.topK,
      });
      return mapResult(
        await request(client, {
          body,
          error: SemanticSearchError,
          failure: readinessFailure,
          failureSchema: semanticSearchFailureSchema,
          method: 'POST',
          path: '/api/project/search',
          schema: semanticSearchResponseSchema,
          signal,
        }),
      );
    },
  };
}
