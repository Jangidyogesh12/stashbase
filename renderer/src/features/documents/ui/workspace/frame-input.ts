import type { SubscribeDocumentInput } from '@/features/documents/application/ports';

/** DOM input does not bubble out of an opaque iframe. Native input presence is
 * independent of document scripts; focus/hover scope it without reading content. */
export function listenForFrameInput(
  host: HTMLElement,
  subscribe: SubscribeDocumentInput,
  onRead: () => void,
): () => void {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const release = subscribe((kind) => {
    clearTimeout(pending);
    // A pointer press establishes frame focus as the input is dispatched.
    pending = setTimeout(() => {
      const owner = host.ownerDocument;
      const focused = owner.activeElement;
      if (
        owner.visibilityState === 'visible' &&
        owner.hasFocus() &&
        focused instanceof HTMLIFrameElement &&
        host.contains(focused) &&
        (kind === 'keyboard' || focused.matches(':hover'))
      )
        onRead();
    }, 0);
  });
  return () => {
    clearTimeout(pending);
    release();
  };
}
