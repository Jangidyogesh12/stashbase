import type { DelimitedTablePage } from '@/features/documents/domain/table';

export interface TableUnavailableCopy {
  description: string;
  title: string;
}

const UNCHANGED = 'The file has not been changed.';

/** Why a CSV cannot open, and what the reader can do about it. An encoding
 *  StashBase can name is named, with the way to save the file again as UTF-8. */
export function tableUnavailableCopy(
  page: Exclude<DelimitedTablePage, { kind: 'table' }>,
): TableUnavailableCopy {
  switch (page.kind) {
    case 'unsupported-encoding':
      if (page.encoding === 'utf-16le' || page.encoding === 'utf-16be') {
        return {
          description: `This file is saved as UTF-16. StashBase opens CSV saved as UTF-8: save it again as CSV UTF-8 in your spreadsheet app. ${UNCHANGED}`,
          title: 'Saved as UTF-16',
        };
      }
      if (page.encoding === 'gb18030') {
        // A guess: other legacy encodings can read as GBK too.
        return {
          description: `This file may be GBK or GB18030, which Excel uses for CSV on Chinese Windows. StashBase opens CSV saved as UTF-8: in Excel, choose Save As, then CSV UTF-8. ${UNCHANGED}`,
          title: 'Not saved as UTF-8',
        };
      }
      return {
        description: `This file uses an encoding other than UTF-8, such as Windows-1252. StashBase opens CSV saved as UTF-8: save it again as CSV UTF-8 in the app that made it. ${UNCHANGED}`,
        title: 'Not saved as UTF-8',
      };
    case 'binary':
      return {
        description: `This file holds binary data, not delimited text. ${UNCHANGED}`,
        title: 'Not a text table',
      };
    case 'too-large':
      return {
        description: 'StashBase opens tables up to 512 MiB. Open this one in a spreadsheet app.',
        title: 'Table is too large to open',
      };
  }
}
