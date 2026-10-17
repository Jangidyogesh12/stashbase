import { filesystemPath } from '../filesystem-path.ts';
import { remapKeywordFilesForDisplay, type KeywordHitFile } from '../search-display.ts';
import type { SourceEvidence } from './evidence.ts';

function keywordEvidence(files: KeywordHitFile[], folderRoot: string): SourceEvidence[] {
  const evidence: SourceEvidence[] = [];
  for (const file of files) {
    const sourcePath = filesystemPath.absolute(file.path, folderRoot);
    for (const match of file.matches) {
      evidence.push({
        sourcePath,
        snippet: match.text,
        ranges: match.ranges,
        sourceMatchCount: file.totalMatches,
        locator: {
          line: match.line,
          ...(match.pdfPage == null ? {} : { page: match.pdfPage }),
        },
      });
    }
  }
  return evidence;
}

export function visibleKeywordEvidence(files: KeywordHitFile[], folderRoot: string): SourceEvidence[] {
  return keywordEvidence(remapKeywordFilesForDisplay(files, folderRoot).files, folderRoot);
}
