import type { ReactNode } from 'react';

import type { DocumentRuntime } from '@/features/documents/application/document-runtime';
import type { DocumentNavigationRuntime } from '@/features/documents/application/navigation-runtime';
import type { DocumentSourcePort } from '@/features/documents/application/ports';
import { CodeEditorDocument } from '@/features/documents/ui/code-editor/document';

import { TextSurface } from './text';
import type { DocumentViewerStatus } from './viewer';

/** A text source edited as plain text: a `.txt` file, or a table's source. */
export function PlainTextSource({
  active,
  name,
  navigation,
  runtime,
  sourceApi,
  status,
}: {
  active: boolean;
  name: string;
  navigation: DocumentNavigationRuntime;
  runtime: DocumentRuntime;
  sourceApi: DocumentSourcePort;
  status(status: DocumentViewerStatus): ReactNode;
}) {
  return (
    <TextSurface
      active={active}
      editorLabel="text editor"
      name={name}
      runtime={runtime}
      sourceApi={sourceApi}
      status={status}
    >
      {({ onChange, readOnly, value }) => (
        <CodeEditorDocument
          active={active}
          ariaLabel={`${name} source`}
          content={value}
          language={{ kind: 'plain' }}
          navigation={navigation}
          onChange={onChange}
          readOnly={readOnly}
          runtime={runtime}
        />
      )}
    </TextSurface>
  );
}
