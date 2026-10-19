/**
 * The Files tree as the sidebar composes it: rows at their real inset, one
 * folder open, and the row that is taking a new name.
 *
 * The stories render the tree's presentational parts over a listing built
 * from the workspace fixtures, rather than the `FileTree` container, so the
 * composition can be pinned in a state (a rename mid-flight) that the
 * container only reaches through a gesture and a live runtime.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  buildTree,
  visibleTree,
  type ExpandedFolders,
  type TreeRow,
} from '@/features/workspace/domain/tree';
import { listing, listingFile, listingFolder, RESEARCH_FOLDER } from '@/test/fakes/workspace';

import { RenameNameRow } from './file-tree-naming';
import { FileTreeRow, type FileTreeRowMarker } from './file-tree-rows';

const REVEAL_LABEL = 'Show in file manager';

const RESEARCH_LISTING = listing(
  [
    listingFile({ path: 'MISSION.md' }),
    listingFile({ format: 'json', path: 'index.json' }),
    listingFile({ path: 'lessons/week-1.md' }),
    listingFile({ path: 'lessons/week-2.md' }),
    listingFile({ format: 'pdf', path: 'reference/style-guide.pdf' }),
  ],
  [listingFolder({ path: 'lessons' }), listingFolder({ path: 'reference' })],
);

const EXPANDED: ExpandedFolders = { lessons: true };

const MARKERS: Readonly<Record<string, FileTreeRowMarker>> = {
  'reference/style-guide.pdf': { kind: 'failed', title: 'Preparation failed' },
};

function rowsOf(expanded: ExpandedFolders): TreeRow[] {
  return visibleTree(buildTree(RESEARCH_LISTING), expanded);
}

interface TreePreviewProps {
  /** Folder-relative path of the row whose name is being typed, if any. */
  renaming?: string;
  selectedPath?: string;
}

function TreePreview({ renaming, selectedPath = 'lessons/week-1.md' }: TreePreviewProps) {
  const rows = rowsOf(EXPANDED);
  return (
    <div className="w-full">
      <section aria-label="Files" className="min-w-0 px-2 py-2">
        <div aria-label="Files" className="relative" role="tree" tabIndex={-1}>
          {rows.map((row, index) => {
            const expanded = row.node.type === 'folder' && EXPANDED[row.node.path] === true;
            if (renaming === row.node.path) {
              return (
                <RenameNameRow
                  caretOffset={undefined}
                  expanded={expanded}
                  key={row.node.path}
                  onCancel={() => undefined}
                  onCommit={() => undefined}
                  problem={null}
                  row={row}
                />
              );
            }
            return (
              <FileTreeRow
                expanded={expanded}
                folderPath={RESEARCH_FOLDER.path}
                index={index}
                key={row.node.path}
                marker={row.node.type === 'file' ? MARKERS[row.node.path] : undefined}
                onActivate={() => undefined}
                onDragEnd={() => undefined}
                onDragStart={() => undefined}
                onFocus={() => undefined}
                onKeep={() => undefined}
                onKeyDown={() => undefined}
                onRename={() => undefined}
                proximityActive={false}
                registerRow={() => undefined}
                revealLabel={REVEAL_LABEL}
                row={row}
                selected={selectedPath === row.node.path}
                tabStop={rows[0]?.node.path === row.node.path}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

const meta = {
  component: TreePreview,
  parameters: {
    controls: { disable: true },
    fluidCanvas: { minHeight: '18rem', width: '22rem' },
  },
  title: 'Compositions/Files tree',
} satisfies Meta<typeof TreePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A folder open over its children, with a prepared-file marker on a sibling
 *  branch and the selected row carrying the tree's tab stop rules. */
export const FolderOpen: Story = {};

/** The same tree with one row handed over to the name field: the row keeps its
 *  inset and rails, so nothing under the pointer moves while a name is typed. */
export const RenameInProgress: Story = {
  args: { renaming: 'lessons/week-1.md', selectedPath: 'lessons/week-1.md' },
};
