import { describe, expect, it } from 'vite-plus/test';

import { listing, listingFile, listingFolder } from '@/test/fakes/workspace';

import {
  buildTree,
  entryNameProblem,
  fileIsRestricted,
  joinTreePath,
  nextTreePath,
  parentTreePath,
  renamedTreePath,
  systemEntryPath,
  treeCreationParent,
  treePathWithin,
  untitledDraftName,
  visibleTree,
} from './tree';

const CHAPTER10 = listingFile({ path: 'notes/chapter10.md', size: 10 });
const CHAPTER2 = listingFile({ path: 'notes/chapter2.md', size: 2 });
const SOCKET = listingFile({
  availability: 'unreadable',
  format: 'generic',
  kind: 'special',
  path: 'socket',
  size: 0,
});
const RESEARCH_LISTING = listing(
  [CHAPTER10, CHAPTER2, SOCKET],
  [listingFolder({ kind: 'excluded', path: 'vendor' }), 'notes/drafts', 'folder10', 'folder2'],
);

describe('workspace tree model', () => {
  it('builds implied parents and sorts folders before files with natural names', () => {
    const tree = buildTree(RESEARCH_LISTING);

    expect(tree.map((node) => node.name)).toEqual([
      'folder2',
      'folder10',
      'notes',
      'vendor',
      'socket',
    ]);
    const notes = tree[2];
    expect(notes?.type).toBe('folder');
    if (notes?.type !== 'folder') throw new Error('Expected notes folder.');
    expect(notes.children.map((node) => node.name)).toEqual([
      'drafts',
      'chapter2.md',
      'chapter10.md',
    ]);
  });

  it('uses expanded state as the only source of visible order and hides restricted descendants', () => {
    const tree = buildTree({
      ...RESEARCH_LISTING,
      files: [...RESEARCH_LISTING.files, { ...CHAPTER10, path: 'vendor/private.md' }],
    });

    expect(visibleTree(tree, {}).map((row) => row.node.path)).not.toContain('notes/chapter2.md');
    const rows = visibleTree(tree, { notes: true, vendor: true });
    expect(rows.map((row) => row.node.path)).toContain('notes/chapter2.md');
    expect(rows.map((row) => row.node.path)).not.toContain('vendor/private.md');
    expect(rows.find((row) => row.node.path === 'notes/chapter2.md')).toMatchObject({
      depth: 2,
      parentPath: 'notes',
      position: 2,
      setSize: 3,
    });
  });

  it('classifies non-regular and unreadable files as reveal-only', () => {
    expect(fileIsRestricted(SOCKET)).toBe(true);
    expect(fileIsRestricted(CHAPTER10)).toBe(false);
  });

  it('moves within the same visible rows used for rendering', () => {
    const rows = visibleTree(buildTree(RESEARCH_LISTING), { notes: true });

    expect(nextTreePath('Home', 'notes', rows)).toBe('folder2');
    expect(nextTreePath('End', 'notes', rows)).toBe('socket');
    expect(nextTreePath('ArrowDown', 'notes', rows)).toBe('notes/drafts');
    expect(nextTreePath('ArrowUp', 'notes', rows)).toBe('folder10');
    expect(nextTreePath('PageDown', 'notes', rows)).toBeNull();
  });

  it('derives entry paths from a parent and one leaf name', () => {
    expect(parentTreePath('notes/drafts/plan.md')).toBe('notes/drafts');
    expect(parentTreePath('plan.md')).toBe('');
    expect(joinTreePath('', 'plan.md')).toBe('plan.md');
    expect(joinTreePath('notes', 'plan.md')).toBe('notes/plan.md');
    expect(renamedTreePath('notes/plan.md', 'outline.md')).toBe('notes/outline.md');
    expect(renamedTreePath('notes', 'archive')).toBe('archive');
    expect(treePathWithin('notes/plan.md', 'notes')).toBe(true);
    expect(treePathWithin('notes', 'notes')).toBe(true);
    expect(treePathWithin('notes-old/plan.md', 'notes')).toBe(false);
  });

  it('writes copied entry paths with the project folder’s own separator', () => {
    expect(systemEntryPath('/Users/me/Notes', 'drafts/plan.md', 'absolute')).toBe(
      '/Users/me/Notes/drafts/plan.md',
    );
    expect(systemEntryPath('/Users/me/Notes', 'drafts/plan.md', 'relative')).toBe('drafts/plan.md');
    expect(systemEntryPath('C:\\Users\\me\\Notes', 'drafts/plan.md', 'absolute')).toBe(
      'C:\\Users\\me\\Notes\\drafts\\plan.md',
    );
    expect(systemEntryPath('C:\\', 'plan.md', 'absolute')).toBe('C:\\plan.md');
    expect(systemEntryPath('\\\\server\\share\\Notes', 'drafts/plan.md', 'relative')).toBe(
      'drafts\\plan.md',
    );
  });

  it('explains names that cannot become entries before any request', () => {
    expect(entryNameProblem('plan.md')).toBeNull();
    expect(entryNameProblem('  ')).toBe('Enter a name.');
    expect(entryNameProblem('a/b')).toBe('A name cannot contain slashes.');
    expect(entryNameProblem('a\\b')).toBe('A name cannot contain slashes.');
    expect(entryNameProblem('..')).toBe('That name is reserved.');
    expect(entryNameProblem('x'.repeat(256))).toBe('That name is too long.');
  });
});

describe('new entry placement and naming', () => {
  it('names a new draft Untitled and counts past the siblings already so named', () => {
    expect(untitledDraftName(RESEARCH_LISTING, '')).toBe('Untitled.md');
    expect(untitledDraftName(RESEARCH_LISTING, 'notes')).toBe('Untitled.md');
    const crowded = listing(
      [
        listingFile({ path: 'notes/untitled.md' }),
        listingFile({ path: 'notes/Untitled 2.md' }),
        listingFile({ path: 'Untitled 3.md' }),
      ],
      ['notes'],
    );
    // Case does not free a name, and a sibling elsewhere does not take one.
    expect(untitledDraftName(crowded, 'notes')).toBe('Untitled 3.md');
    expect(untitledDraftName(crowded, '')).toBe('Untitled.md');
  });

  it('places a new entry beside the selection, or at the root with none', () => {
    expect(treeCreationParent(RESEARCH_LISTING, null)).toBe('');
    expect(treeCreationParent(RESEARCH_LISTING, 'notes/drafts')).toBe('notes/drafts');
    // A folder the listing only implies is still a folder.
    expect(treeCreationParent(RESEARCH_LISTING, 'notes')).toBe('notes');
    expect(treeCreationParent(RESEARCH_LISTING, 'notes/chapter2.md')).toBe('notes');
    expect(treeCreationParent(RESEARCH_LISTING, 'socket')).toBe('');
  });
});
