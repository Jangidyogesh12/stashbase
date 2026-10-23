'use client';

import {
  FileAudio,
  FileCode2,
  FileImage,
  FileJson2,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

import { useSize } from '@/lib/size-context';
import { fileExtensionOf } from '@/shared/utils/file-path';

const EXTENSION_ICONS: Record<string, LucideIcon> = {
  aac: FileAudio,
  avi: FileVideo,
  bmp: FileImage,
  css: FileCode2,
  csv: FileSpreadsheet,
  docx: FileText,
  flac: FileAudio,
  gif: FileImage,
  heic: FileImage,
  htm: FileCode2,
  html: FileCode2,
  jpeg: FileImage,
  jpg: FileImage,
  js: FileCode2,
  json: FileJson2,
  jsx: FileCode2,
  m4a: FileAudio,
  m4v: FileVideo,
  md: FileText,
  mov: FileVideo,
  mp3: FileAudio,
  mp4: FileVideo,
  ogg: FileAudio,
  pdf: FileType2,
  png: FileImage,
  svg: FileImage,
  ts: FileCode2,
  tsv: FileSpreadsheet,
  tsx: FileCode2,
  txt: FileText,
  wav: FileAudio,
  webm: FileVideo,
  webp: FileImage,
  xlsx: FileSpreadsheet,
};

interface FileTypeIconProps extends LucideProps {
  path: string;
}

/** The file glyph, at the ladder's size and the site's resting stroke.
 *
 *  Both defaults live here rather than at each call site. The same `.md` mark
 *  is drawn in a search result, a Chat attachment row, a mention row and a
 *  transcript chip, and while every caller spelled its own numbers those
 *  copies drifted: four of them kept lucide's default stroke of 2, one wrote
 *  1.5, and the sizes ran 12, 14 and 16 with no rule behind which was which.
 *
 *  A caller with a scale of its own still passes `size` — a tile glyph
 *  measured off its thumbnail, or an inline chip on a 12px text line — but it
 *  is now saying something, rather than restating the default. */
export function FileTypeIcon({ path, size, strokeWidth = 1.5, ...props }: FileTypeIconProps) {
  const sizeClasses = useSize();
  const Icon = EXTENSION_ICONS[fileExtensionOf(path)] ?? FileQuestion;
  return <Icon {...props} size={size ?? sizeClasses.icon} strokeWidth={strokeWidth} />;
}
