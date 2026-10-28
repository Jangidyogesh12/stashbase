/** Bind a form to the same JSON document used by its source editor and close barriers. */
import { sourceIdentity } from '@/features/documents/domain/document';
import { htmlDataSource } from '@/features/documents/domain/html-data';
import type { SourceReference } from '@/shared/domain/source-reference';

import type { DocumentRuntime } from './document-runtime';
import { createHtmlDataSession } from './html-data-session';
import type { DocumentSourcePort } from './ports';

export function bindHtmlData(
  owner: DocumentRuntime,
  context: {
    api: DocumentSourcePort;
    documents: Map<string, DocumentRuntime>;
    sourceIds: Map<string, string>;
    createChild(id: string, source: SourceReference): DocumentRuntime;
    createId(): string;
    keep(id: string): boolean;
    reveal(document: DocumentRuntime): void;
    release(document: DocumentRuntime): void;
  },
): void {
  const rebind = owner.rebind;
  owner.rebind = (source, queries) => {
    rebind(source, queries);
    bindSession();
  };
  bindSession();

  function bindSession() {
    const source = htmlDataSource(owner.scope.source);
    if (!source) return;
    const lookup = (target: SourceReference) => {
      const id = context.sourceIds.get(sourceIdentity(target));
      return id ? (context.documents.get(id) ?? null) : null;
    };
    const acquire = (target: SourceReference) => {
      let document = lookup(target);
      if (!document) {
        document = context.createChild(context.createId(), target);
      }
      return document;
    };
    const data = createHtmlDataSession({
      owner,
      source,
      api: context.api,
      acquire,
      lookup,
      keep: () => {
        context.keep(owner.scope.id);
      },
      reveal: context.reveal,
    });
    if (!owner.htmlData) {
      const save = owner.save;
      owner.save = async (api) => (await owner.htmlData?.flush()) !== false && save(api);
    }
    owner.htmlData = data;
    owner.signal.addEventListener(
      'abort',
      () => {
        const document = data.store.getState().document;
        if (document) queueMicrotask(() => context.release(document));
      },
      { once: true },
    );
  }
}
