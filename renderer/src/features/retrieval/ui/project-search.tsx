import { useMemo } from 'react';

import type { ExactSearchPort, SemanticSearchPort } from '@/features/retrieval/application/ports';

import { offeredBackends, searchBackends } from './search/backends';
import { SearchSurface, type SearchSurfaceProps } from './search/surface';

export interface ProjectSearchProps extends Omit<SearchSurfaceProps, 'backends' | 'folderPath'> {
  activeFolderPath: string;
  exactApi: ExactSearchPort;
  semanticApi: SemanticSearchPort;
}

/** Search over the selected workspace folder, with the shipped set of search
 *  backends bound to their transports. A backend the index gates is offered
 *  only once search by meaning is set up: until then the surface is keyword
 *  search alone, with no tab naming a mode the reader has not turned on. */
export function ProjectSearch({
  activeFolderPath,
  exactApi,
  semanticApi,
  ...props
}: ProjectSearchProps) {
  const backends = useMemo(
    () => searchBackends({ exactApi, semanticApi }),
    [exactApi, semanticApi],
  );
  const offered = useMemo(
    () => offeredBackends(backends, props.readiness),
    [backends, props.readiness],
  );
  return <SearchSurface {...props} backends={offered} folderPath={activeFolderPath} />;
}
