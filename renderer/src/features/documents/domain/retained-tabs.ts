import { documentViewerFormat } from './document-format';

export interface RetainableDocumentTab {
  id: string;
  source: { path: string };
}

/** Keep live Markdown editors and HTML forms mounted across navigation. */
export function retainDocumentTabIds(
  retainedIds: readonly string[],
  tabs: readonly RetainableDocumentTab[],
  activeTabId: string | null,
): string[] {
  const retainedFormats = new Set(
    tabs
      .filter((tab) => ['md', 'html'].includes(documentViewerFormat(tab.source.path)))
      .map((tab) => tab.id),
  );
  const next = retainedIds.filter((id) => retainedFormats.has(id));
  if (activeTabId && retainedFormats.has(activeTabId)) {
    const previousIndex = next.indexOf(activeTabId);
    if (previousIndex >= 0) next.splice(previousIndex, 1);
    next.unshift(activeTabId);
  }
  return next;
}
