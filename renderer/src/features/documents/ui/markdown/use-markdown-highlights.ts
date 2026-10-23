/** Lifetimes for Find and chat-reference highlights on a retained Markdown tab. */
import type { CrepeBuilder } from '@milkdown/crepe/builder';
import { useCallback, useEffect, useRef, type RefObject } from 'react';

import type { DocumentNavigationRuntime } from '@/features/documents/application/navigation-runtime';
import type { DocumentSelection } from '@/features/documents/domain/selection';
import type { SourceReference } from '@/shared/domain/source-reference';

import { createMarkdownFindController } from './find-controller';
import { documentScroller } from './outline-adapter';
import { attachPassageHighlights } from './passage-highlights';

export function useMarkdownHighlights({
  active,
  creationState,
  hostRef,
  navigation,
  referencedPassages,
  source,
  tabId,
}: {
  active: boolean;
  creationState: 'creating' | 'failed' | 'ready';
  hostRef: RefObject<HTMLDivElement | null>;
  navigation: DocumentNavigationRuntime;
  referencedPassages: readonly DocumentSelection[] | undefined;
  source: SourceReference;
  tabId: string;
}) {
  const passagesRef = useRef<ReturnType<typeof attachPassageHighlights> | null>(null);
  const owner = useRef(Symbol(tabId));
  const attach = useCallback((editor: CrepeBuilder) => {
    const passages = attachPassageHighlights(editor);
    passagesRef.current = passages;
    return () => {
      if (passagesRef.current === passages) passagesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (creationState !== 'ready') return;
    passagesRef.current?.setReferences(
      (referencedPassages ?? [])
        .filter(
          (passage) =>
            passage.source.folderPath === source.folderPath && passage.source.path === source.path,
        )
        .map((passage) => passage.markdown),
    );
  }, [creationState, referencedPassages, source.folderPath, source.path]);

  useEffect(() => {
    if (!active && creationState === 'ready') passagesRef.current?.clearFocus();
  }, [active, creationState]);

  useEffect(() => {
    if (!active || creationState !== 'ready') return;
    const host = hostRef.current;
    const proseMirror = host?.querySelector<HTMLElement>('.ProseMirror');
    const passages = passagesRef.current;
    if (!host || !proseMirror || !passages) return;
    const controller = createMarkdownFindController(proseMirror, documentScroller(host));
    const release = navigation.claimFind(tabId, owner.current, {
      ...controller,
      locatePassage: passages.reveal,
    });
    return () => {
      release();
      controller.dispose();
    };
  }, [active, creationState, hostRef, navigation, tabId]);

  return attach;
}
