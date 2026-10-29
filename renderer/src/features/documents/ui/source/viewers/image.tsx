import { lazy } from 'react';

import { AssetSurface } from '@/features/documents/ui/source/asset';
import type { DocumentViewerProps } from '@/features/documents/ui/source/viewer';

const ImageDocument = lazy(async () => {
  const module = await import('@/features/documents/ui/image/document');
  return { default: module.ImageDocument };
});

export default function ImageViewer({
  assetApi,
  name,
  ...surface
}: DocumentViewerProps<'assetApi'>) {
  return (
    <AssetSurface {...surface} api={assetApi} name={name}>
      {({ asset }) => <ImageDocument key={asset.version} name={name} resource={asset} />}
    </AssetSurface>
  );
}
