/**
 * HTML previews render inside a sandboxed frame: the archived page's own
 * markup never runs in the renderer, and every link it offers is routed back
 * through the workspace's navigation callbacks.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import type { HtmlDataSession } from '@/features/documents/application/html-data-session';
import type { DocumentNavigationRuntime } from '@/features/documents/application/navigation-runtime';
import type { DocumentAsset } from '@/features/documents/application/ports';
import { resolveDocumentLink } from '@/features/documents/domain/link-target';
import { LinkFailureNotice } from '@/features/documents/ui/link-failure-notice';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';
import type { SourceReference } from '@/shared/domain/source-reference';

import { createHtmlFrameFindController } from './find-controller';
import { useHtmlDataBridge } from './use-data-bridge';

interface FrameLinkMessage {
  href: string;
  type: 'stashbase-nav' | 'stashbase-open-external';
}

function frameLinkMessage(value: unknown): FrameLinkMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (
    (message.type !== 'stashbase-nav' && message.type !== 'stashbase-open-external') ||
    typeof message.href !== 'string' ||
    message.href.length === 0 ||
    message.href.length > 8_192
  ) {
    return null;
  }
  return { href: message.href, type: message.type };
}

function hasUserActivation(): boolean {
  return globalThis.navigator.userActivation?.isActive === true;
}

function resolvedViewerTheme(): 'dark' | 'light' {
  const root = globalThis.document.documentElement;
  if (root.classList.contains('dark')) return 'dark';
  if (root.classList.contains('light')) return 'light';
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export interface SandboxedHtmlFrameProps {
  data?: HtmlDataSession | undefined;
  active: boolean;
  name: string;
  navigation: DocumentNavigationRuntime;
  onNavigate(target: { anchor?: string | undefined; source: SourceReference }): void;
  onOpenExternal(href: string): Promise<boolean>;
  source: SourceReference;
  tabId: string;
  trustedLinks?: boolean;
  url: string;
}

/**
 * Compatibility HTML runs with an opaque origin. Its scripts can render the
 * document but receive no same-origin access, preload bridge, navigation,
 * popup, form, download, or permission capability.
 */
export function SandboxedHtmlFrame({
  active,
  data,
  name,
  navigation,
  onNavigate,
  onOpenExternal,
  source,
  tabId,
  trustedLinks = false,
  url,
}: SandboxedHtmlFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useHtmlDataBridge(frameRef, data, url, active);
  const loadedRef = useRef(false);
  const ownerRef = useRef(Symbol(tabId));
  const shape = useShape();
  const [linkFailed, setLinkFailed] = useState(false);
  const pendingAnchor = useStore(navigation.store, (state) =>
    state.pendingAnchor?.tabId === tabId ? state.pendingAnchor.id : null,
  );

  useEffect(() => {
    loadedRef.current = false;
    setLinkFailed(false);
  }, [url]);

  useEffect(() => {
    if (!active) return;
    const postTheme = () => {
      frameRef.current?.contentWindow?.postMessage(
        { theme: resolvedViewerTheme(), type: 'stashbase-theme' },
        '*',
      );
    };
    const preference = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    preference?.addEventListener('change', postTheme);
    const observer = new MutationObserver(postTheme);
    observer.observe(globalThis.document.documentElement, {
      attributeFilter: ['class'],
      attributes: true,
    });
    postTheme();
    return () => {
      preference?.removeEventListener('change', postTheme);
      observer.disconnect();
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const controller = createHtmlFrameFindController(() => frameRef.current?.contentWindow ?? null);
    const release = navigation.claimFind(tabId, ownerRef.current, controller);
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (controller.accept(event.data)) return;
      if (!event.data || typeof event.data !== 'object') return;
      const message = event.data as Record<string, unknown>;
      if (message.type === 'stashbase-open-find') {
        navigation.openFind();
        return;
      }
      if (message.type === 'stashbase-find-step') {
        if (message.dir === 'prev') navigation.findPrevious();
        else if (message.dir === 'next') navigation.findNext();
        return;
      }

      const link = frameLinkMessage(message);
      if (!link || (!trustedLinks && !hasUserActivation())) return;
      if (link.type === 'stashbase-nav') {
        const target = resolveDocumentLink(link.href, source);
        if (target.kind === 'anchor') onNavigate({ anchor: target.id, source });
        else if (target.kind === 'source') {
          onNavigate({ anchor: target.anchor, source: target.source });
        }
        return;
      }

      let external: URL;
      try {
        external = new URL(link.href);
      } catch {
        // swallowed: a link the document authored that is not a URL at all is
        // not ours to open, and there is nothing to tell the reader about it.
        return;
      }
      if (
        (external.protocol !== 'http:' && external.protocol !== 'https:') ||
        external.origin === new URL(url).origin
      ) {
        return;
      }
      setLinkFailed(false);
      void onOpenExternal(external.href)
        .then((opened) => setLinkFailed(!opened))
        .catch(() => setLinkFailed(true));
    };
    globalThis.addEventListener('message', receive);
    return () => {
      globalThis.removeEventListener('message', receive);
      release();
      controller.dispose();
    };
  }, [active, navigation, onNavigate, onOpenExternal, source, tabId, trustedLinks, url]);

  useEffect(() => {
    if (!active || !loadedRef.current || !pendingAnchor) return;
    frameRef.current?.contentWindow?.postMessage(
      { id: pendingAnchor, type: 'stashbase-scroll' },
      '*',
    );
    navigation.consumeAnchor(tabId, pendingAnchor);
  }, [active, navigation, pendingAnchor, tabId]);

  const loaded = () => {
    loadedRef.current = true;
    if (data) frameRef.current?.contentWindow?.postMessage({ type: 'stashbase-data-ready' }, '*');
    frameRef.current?.contentWindow?.postMessage(
      { theme: resolvedViewerTheme(), type: 'stashbase-theme' },
      '*',
    );
    const state = navigation.store.getState();
    if (state.pendingAnchor?.tabId === tabId) {
      frameRef.current?.contentWindow?.postMessage(
        { id: state.pendingAnchor.id, type: 'stashbase-scroll' },
        '*',
      );
      navigation.consumeAnchor(tabId, state.pendingAnchor.id);
    }
    if (state.find.open && state.find.query) navigation.setFindQuery(state.find.query);
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-2 p-2">
      <LinkFailureNotice failed={linkFailed} onDismiss={() => setLinkFailed(false)} />
      <div
        className={cn(
          'size-full overflow-hidden border border-border bg-surface-3 shadow-surface-2',
          shape.container,
        )}
      >
        <iframe
          className="block size-full border-0 bg-white"
          onLoad={loaded}
          ref={frameRef}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts"
          src={url}
          title={`${name} HTML preview`}
        />
      </div>
    </div>
  );
}

export function HtmlDocument({
  active,
  data,
  name,
  navigation,
  onNavigate,
  onOpenExternal,
  resource,
  source,
  tabId,
}: Omit<SandboxedHtmlFrameProps, 'trustedLinks' | 'url'> & { resource: DocumentAsset }) {
  return (
    <SandboxedHtmlFrame
      active={active}
      data={data}
      name={name}
      navigation={navigation}
      onNavigate={onNavigate}
      onOpenExternal={onOpenExternal}
      source={source}
      tabId={tabId}
      url={resource.url}
    />
  );
}
