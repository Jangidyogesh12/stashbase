/** The preload capability for files dropped on the document pane. Absent in
 *  the web build, where a dropped `File` has no location on disk.
 *
 *  It takes the dropped `File` itself: preload reads its location,
 *  so the renderer never names a path. Answers arrive as `unknown` and are
 *  parsed in the Documents feature's infrastructure. */
export interface ExternalFilesBridge {
  open(file: File): Promise<unknown>;
}

export function isExternalFilesBridge(value: unknown): value is ExternalFilesBridge {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.open === 'function';
}
