import { CsvDocument } from '@/features/documents/ui/csv/document';
import type { DocumentViewerProps } from '@/features/documents/ui/source/viewer';

export default function CsvViewer({
  active,
  name,
  navigation,
  onAskAgent,
  runtime,
  sourceApi,
  status,
  tableApi,
}: DocumentViewerProps<'navigation' | 'onAskAgent' | 'sourceApi' | 'tableApi'>) {
  return (
    <CsvDocument
      active={active}
      name={name}
      navigation={navigation}
      onAskAgent={onAskAgent}
      runtime={runtime}
      sourceApi={sourceApi}
      status={status}
      tableApi={tableApi}
    />
  );
}
