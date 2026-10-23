import type { GenericFilePreview } from '@/features/documents/domain/generic-preview';

export interface GenericPreviewCopy {
  description: string;
  title: string;
}

export function genericPreviewCopy(
  preview: Exclude<GenericFilePreview, { kind: 'text' | 'spreadsheet' }>,
): GenericPreviewCopy {
  switch (preview.kind) {
    case 'invalid-spreadsheet':
      return {
        description:
          preview.message ??
          'The workbook may be damaged or password-protected. Open it in a spreadsheet app.',
        title: 'Workbook cannot be previewed',
      };
    case 'too-large':
      return {
        description: 'StashBase previews text files and workbooks up to 8 MiB.',
        title: 'File is too large to open',
      };
    case 'unreadable':
      return {
        description: 'Check the file permissions or inspect it in the system file manager.',
        title: 'File cannot be read',
      };
    case 'cloud-placeholder':
      return {
        description: 'Download this cloud file in the system file manager, then try again.',
        title: 'File is not downloaded',
      };
    case 'symlink':
      return {
        description: 'StashBase shows symbolic links but does not follow them.',
        title: 'Symbolic link cannot be opened',
      };
    case 'special':
      return {
        description: 'This filesystem entry is not a regular file.',
        title: 'Filesystem entry cannot be opened',
      };
    case 'binary':
      return {
        description: 'This file is binary or does not contain valid UTF-8 text.',
        title: 'Binary file cannot be opened',
      };
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} kB`;
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}
