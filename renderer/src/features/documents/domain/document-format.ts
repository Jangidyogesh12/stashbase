import { viewerFormatOfPath, type ViewerFormat } from '@/contracts/file-formats';

/** The formats whose source file is itself the editable text. */
export type DocumentTextFormat = Extract<ViewerFormat, 'csv' | 'json' | 'md' | 'txt'>;

/** The renderer speaks the same format vocabulary as the server file listing;
 *  a name nothing claims opens as `generic`. */
export type DocumentViewerFormat = ViewerFormat;

export function documentTextFormat(path: string): DocumentTextFormat | null {
  const format = viewerFormatOfPath(path);
  return format === 'md' || format === 'json' || format === 'txt' || format === 'csv'
    ? format
    : null;
}

export function documentViewerFormat(path: string): DocumentViewerFormat {
  return viewerFormatOfPath(path);
}
