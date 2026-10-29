import { lazy } from 'react';

import { AssetSurface } from '@/features/documents/ui/source/asset';
import type { DocumentViewerProps } from '@/features/documents/ui/source/viewer';

const ImageDocument = lazy(async () => {
  const module = await import('@/features/documents/ui/image/document');
  return { default: module.ImageDocument };
});

export default function ImageViewer({
  active,
  assetApi,
  name,
  runtime,
  status,
}: DocumentViewerProps<'assetApi'>) {
  return (
    <AssetSurface active={active} api={assetApi} name={name} runtime={runtime} status={status}>
      {({ asset }) => <ImageDocument key={asset.version} name={name} resource={asset} />}
    </AssetSurface>
  );
}
