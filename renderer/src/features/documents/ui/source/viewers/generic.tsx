import { GenericFileDocument } from '@/features/documents/ui/generic/document';
import type { DocumentViewerProps } from '@/features/documents/ui/source/viewer';

export default function GenericViewer({
  active,
  genericPreviewApi,
  navigation,
  onAskAgent,
  onReveal,
  revealLabel,
  runtime,
  status,
}: DocumentViewerProps<
  'genericPreviewApi' | 'navigation' | 'onAskAgent' | 'onReveal' | 'revealLabel'
>) {
  return (
    <GenericFileDocument
      active={active}
      api={genericPreviewApi}
      navigation={navigation}
      onAskAgent={onAskAgent}
      onReveal={onReveal}
      revealLabel={revealLabel}
      runtime={runtime}
      status={status}
    />
  );
}
