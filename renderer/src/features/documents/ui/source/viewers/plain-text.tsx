import { PlainTextSource } from '@/features/documents/ui/source/plain-text-source';
import type { DocumentViewerProps } from '@/features/documents/ui/source/viewer';

export default function PlainTextViewer({
  active,
  name,
  navigation,
  runtime,
  sourceApi,
  status,
}: DocumentViewerProps<'navigation' | 'sourceApi'>) {
  return (
    <PlainTextSource
      active={active}
      name={name}
      navigation={navigation}
      runtime={runtime}
      sourceApi={sourceApi}
      status={status}
    />
  );
}
