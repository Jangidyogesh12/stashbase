import type { Meta, StoryObj } from '@storybook/react-vite';

import { SpreadsheetDocument } from './document';

const meta = {
  component: SpreadsheetDocument,
  title: 'Documents/Spreadsheet',
  parameters: { fluidCanvas: { width: '52rem', minHeight: '30rem' } },
  args: {
    workbook: {
      sheetCount: 3,
      hasFormulas: true,
      sheets: [
        {
          name: '销售',
          firstRow: 0,
          firstColumn: 0,
          rowCount: 3,
          columnCount: 4,
          rows: [
            ['产品', '数量', '金额', '日期'],
            ['StashBase Pro', '12', '$1,234.50', '2026-10-23'],
            ['StashBase Plus', '8', '$640.00', '2026-10-24'],
          ],
          formulas: [{ row: 2, column: 2, formula: '=B3*80' }],
        },
        {
          name: 'Notes',
          firstRow: 3,
          firstColumn: 2,
          rowCount: 1,
          columnCount: 1,
          rows: [['Source values are preserved.']],
          formulas: [],
        },
        {
          name: 'Empty',
          firstRow: 0,
          firstColumn: 0,
          rowCount: 0,
          columnCount: 0,
          rows: [],
          formulas: [],
        },
      ],
    },
  },
} satisfies Meta<typeof SpreadsheetDocument>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
