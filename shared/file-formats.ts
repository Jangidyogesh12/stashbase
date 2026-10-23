/**
 * Cross-process file-extension vocabulary.
 *
 * Keep extension membership here so the Node server and renderer cannot drift
 * when a viewable/convertible format is added. Format-specific behavior and
 * MIME types still belong to their owning modules.
 */
export const MARKDOWN_NOTE_EXTENSIONS = ['md', 'markdown'] as const;
export const HTML_NOTE_EXTENSIONS = ['html', 'htm'] as const;
export const NOTE_EXTENSIONS = [...MARKDOWN_NOTE_EXTENSIONS, ...HTML_NOTE_EXTENSIONS] as const;
export const STRUCTURED_DATA_EXTENSIONS = ['json'] as const;
export const PLAIN_TEXT_EXTENSIONS = ['txt'] as const;
export const DIRECT_TEXT_EXTENSIONS = [
  ...NOTE_EXTENSIONS,
  ...STRUCTURED_DATA_EXTENSIONS,
  ...PLAIN_TEXT_EXTENSIONS,
] as const;
export const PDF_EXTENSIONS = ['pdf'] as const;
export const IMAGE_SOURCE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
export const DOCX_EXTENSIONS = ['docx'] as const;
export const AUDIO_ONLY_SOURCE_EXTENSIONS = [
  'mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'aiff', 'aif',
] as const;
export const VIDEO_SOURCE_EXTENSIONS = [
  'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi',
] as const;
export const AUDIO_SOURCE_EXTENSIONS = [
  ...AUDIO_ONLY_SOURCE_EXTENSIONS,
  ...VIDEO_SOURCE_EXTENSIONS,
] as const;

export const CONVERTIBLE_SOURCE_EXTENSIONS = [
  ...PDF_EXTENSIONS,
  ...IMAGE_SOURCE_EXTENSIONS,
  ...DOCX_EXTENSIONS,
] as const;

/** Formats that historically wrote hidden sibling derived notes inside the
 * user folder. */
export const LEGACY_DERIVED_SOURCE_EXTENSIONS = [
  ...PDF_EXTENSIONS,
  ...IMAGE_SOURCE_EXTENSIONS,
  ...DOCX_EXTENSIONS,
] as const;

/** Older converters also emitted extension-less sibling names such as
 * `.paper.md`, but only for PDF and image sources. */
export const LEGACY_EXTENSIONLESS_DERIVED_SOURCE_EXTENSIONS = [
  ...PDF_EXTENSIONS,
  ...IMAGE_SOURCE_EXTENSIONS,
] as const;

export const VIEWABLE_FILE_EXTENSIONS = [
  ...DIRECT_TEXT_EXTENSIONS,
  ...CONVERTIBLE_SOURCE_EXTENSIONS,
  ...AUDIO_SOURCE_EXTENSIONS,
] as const;

export const AUDIO_SOURCE_EXTENSION_ALTERNATION = extensionAlternation(AUDIO_SOURCE_EXTENSIONS);
export const PDF_EXTENSION_ALTERNATION = extensionAlternation(PDF_EXTENSIONS);
export const IMAGE_SOURCE_EXTENSION_ALTERNATION = extensionAlternation(IMAGE_SOURCE_EXTENSIONS);
export const DOCX_EXTENSION_ALTERNATION = extensionAlternation(DOCX_EXTENSIONS);
export const CONVERTIBLE_SOURCE_EXTENSION_ALTERNATION = extensionAlternation(CONVERTIBLE_SOURCE_EXTENSIONS);
export const LEGACY_DERIVED_SOURCE_EXTENSION_ALTERNATION = extensionAlternation(LEGACY_DERIVED_SOURCE_EXTENSIONS);
export const VIEWABLE_FILE_EXTENSION_ALTERNATION = extensionAlternation(VIEWABLE_FILE_EXTENSIONS);

function extensionAlternation(extensions: readonly string[]): string {
  return extensions.map(escapeRegExp).join('|');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Directly readable text formats — the source file is itself the indexed
 * and editable text.
 */
export type DirectTextFormat = 'md' | 'html' | 'json' | 'txt';

/**
 * Everything the renderer can open in the file tree: the direct text
 * formats, convertible binaries (PDF, image, DOCX), and direct-playback media.
 * Playback alone never grants retrieval access.
 *
 * Deliberately wider than `DirectTextFormat` so a convertible source cannot
 * enter the direct-text path. This is the `format` field on the wire — the
 * server's file listing emits it and the renderer routes tabs on it, so the
 * two must agree value for value.
 */
export type KnownViewerFormat = Exclude<ViewerFormat, 'generic'>;

/**
 * The complete workspace-tree format vocabulary. `generic` is deliberately
 * not a known/indexable format: it means only that the source exists and can
 * be selected in the workbench. Opening it performs bounded content
 * inspection and may produce either a read-only text view or an honest
 * binary/unavailable placeholder.
 */
export const VIEWER_FORMATS = [
  'md',
  'html',
  'json',
  'txt',
  'pdf',
  'image',
  'docx',
  'audio',
  'generic',
] as const;

export type ViewerFormat = (typeof VIEWER_FORMATS)[number];

/** The viewer format a file name's extension claims; an unclaimed name is
 *  `generic`. The server's listing reaches the same answer for every name it
 *  shows, so a tab and a tree row agree. */
export function viewerFormatOfPath(path: string): ViewerFormat {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  const claims = (extensions: readonly string[]) => extensions.includes(extension);
  if (claims(MARKDOWN_NOTE_EXTENSIONS)) return 'md';
  if (claims(STRUCTURED_DATA_EXTENSIONS)) return 'json';
  if (claims(PLAIN_TEXT_EXTENSIONS)) return 'txt';
  if (claims(HTML_NOTE_EXTENSIONS)) return 'html';
  if (claims(DOCX_EXTENSIONS)) return 'docx';
  if (claims(PDF_EXTENSIONS)) return 'pdf';
  if (claims(AUDIO_SOURCE_EXTENSIONS)) return 'audio';
  return claims(IMAGE_SOURCE_EXTENSIONS) ? 'image' : 'generic';
}

/** Search and automatic Agent context may consume only these formats. */
export function isRetrievableViewerFormat(format: ViewerFormat): format is Exclude<KnownViewerFormat, 'audio'> {
  return format !== 'generic' && format !== 'audio';
}

/**
 * Formats an external file (one outside the project, dropped on the document
 * pane) may open in place. Only a preview that needs nothing but the file
 * itself qualifies: no prepared output and no neighbouring files. DOCX falls
 * back to prepared output and HTML loads relative resources, so both must be
 * copied into the project; audio and video qualify but are not needed.
 * `generic` opens for UTF-8 text.
 */
export const EXTERNAL_FILE_VIEWER_FORMATS = ['md', 'json', 'txt', 'pdf', 'image', 'generic'] as const;

export type ExternalFileViewerFormat = (typeof EXTERNAL_FILE_VIEWER_FORMATS)[number];

export function isExternalFileViewerFormat(format: ViewerFormat): format is ExternalFileViewerFormat {
  return (EXTERNAL_FILE_VIEWER_FORMATS as readonly string[]).includes(format);
}
