/** The Workbench tree's menu: what a right click or a row's "…" button
 *  offers on a row, and what a right click offers on the tree's own space.
 *  Every entry can be shown in the system file manager and have its path
 *  copied, and those are the only actions a restricted entry keeps. It is
 *  drawn by the shared menu surface, so it reads as the chat rows' menu and
 *  the project switcher do. */
import {
  Copy,
  Eye,
  ExternalLink,
  FilePlus,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import {
  cloneElement,
  useState,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import {
  DropdownContent,
  DropdownMenu,
  DropdownSeparator,
  pointAnchor,
  type DropdownAnchor,
} from '@/components/ui/dropdown';
import { MenuItem } from '@/components/ui/menu-item';
import type { TreeRow, WorkspaceEntry } from '@/features/workspace/domain/tree';

import { entryOf, rowIsRestricted, type FileTreeRowMarker } from './file-tree-rows';

/** Where a right click landed: the tree's own space, or one of its rows. */
export type FileTreeMenuTarget =
  | { kind: 'space' }
  | {
      entry: WorkspaceEntry;
      kind: 'entry';
      /** Reveal and copying the path are all a restricted entry offers. */
      restricted: boolean;
      reprocessable: boolean;
    };

/** The target a row, or the space below the rows, gives the menu. Only a
 *  marked file outside the restricted set can be prepared again. */
export function fileTreeMenuTarget(
  row: TreeRow | undefined,
  marker: FileTreeRowMarker | undefined,
  canReprocess: boolean,
): FileTreeMenuTarget {
  if (!row) return { kind: 'space' };
  const restricted = rowIsRestricted(row);
  const reprocessable = Boolean(marker && canReprocess && !restricted);
  return { entry: entryOf(row), kind: 'entry', reprocessable, restricted };
}

export interface FileTreeMenuActions {
  importFiles?: { disabled: boolean; run(): void } | undefined;
  /** Puts the entry's path on the clipboard, from the disk root or from the
   *  project folder. */
  onCopyPath(entry: WorkspaceEntry, form: 'absolute' | 'relative'): void;
  onCreate(entryKind: WorkspaceEntry['kind'], parentPath: string): void;
  onDelete(entry: WorkspaceEntry): void;
  onRename(entry: WorkspaceEntry): void;
  onReprocess(entry: WorkspaceEntry): void;
  onReveal(entry: WorkspaceEntry): void;
  /** The Workbench-wide hidden-entry visibility, offered on the tree's own
   *  space because it is a property of the whole tree rather than a row. */
  hiddenFiles: { readonly disabled: boolean; readonly shown: boolean; toggle(): void } | null;
}

interface MenuAction {
  destructive?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  run(): void;
  /** Present on a row that carries state rather than only an effect. The row
   *  then announces itself as a checkbox and draws a switch showing which way
   *  it is. */
  switched?: boolean;
}

type MenuRow = MenuAction | 'separator';

function actionsFor(
  target: FileTreeMenuTarget,
  actions: FileTreeMenuActions,
  revealLabel: string,
): MenuRow[] {
  const create = (parentPath: string): MenuAction[] => [
    { icon: FilePlus, label: 'New file', run: () => actions.onCreate('file', parentPath) },
    { icon: FolderPlus, label: 'New folder', run: () => actions.onCreate('folder', parentPath) },
  ];
  if (target.kind === 'space') {
    const rows: MenuRow[] = create('');
    if (actions.importFiles) {
      const { disabled, run } = actions.importFiles;
      rows.push({ disabled, icon: Upload, label: 'Import files…', run });
    }
    if (actions.hiddenFiles) {
      const { disabled, shown, toggle } = actions.hiddenFiles;
      rows.push('separator', {
        disabled,
        icon: Eye,
        label: 'Show hidden files',
        run: toggle,
        switched: shown,
      });
    }
    return rows;
  }
  const { entry } = target;
  // Every entry can be shown where it lives on disk and have that place
  // copied; a restricted one offers nothing else.
  const location: MenuAction[] = [
    { icon: ExternalLink, label: revealLabel, run: () => actions.onReveal(entry) },
    { icon: Copy, label: 'Copy path', run: () => actions.onCopyPath(entry, 'absolute') },
    {
      icon: Copy,
      label: 'Copy relative path',
      run: () => actions.onCopyPath(entry, 'relative'),
    },
  ];
  if (target.restricted) return location;
  // Delete stands last, on its own after a rule, as the item that destroys
  // something does in every menu.
  const own: MenuRow[] = [
    { icon: Pencil, label: 'Rename', run: () => actions.onRename(entry) },
    'separator',
    { destructive: true, icon: Trash2, label: 'Delete', run: () => actions.onDelete(entry) },
  ];
  if (entry.kind === 'folder') {
    return [...create(entry.path), 'separator', ...location, 'separator', ...own];
  }
  const reprocess: MenuAction = {
    icon: RefreshCw,
    label: 'Reprocess',
    run: () => actions.onReprocess(entry),
  };
  return [
    ...(target.reprocessable ? [reprocess, 'separator' as const] : []),
    ...location,
    'separator',
    ...own,
  ];
}

/** Where the menu is showing, and on what. A right click anchors it at the
 *  pointer; a row's "…" button, or the row's menu key, under that button. */
interface ShownMenu {
  align: 'end' | 'start';
  anchor: DropdownAnchor | null;
  target: FileTreeMenuTarget;
}

/** The tree's one menu, held where the rows can reach it. */
export interface FileTreeMenuState {
  readonly open: boolean;
  /** The entry whose menu is open, so its row keeps its "…" showing. */
  readonly openPath: string | null;
  /** Kept through the close, so the rows do not change under the exit. */
  readonly shown: ShownMenu;
  /** Opens the menu on a row, under the control that asked for it. */
  openRow(target: FileTreeMenuTarget, anchor: HTMLElement): void;
  setOpen(open: boolean): void;
  show(shown: ShownMenu): void;
}

export function useFileTreeMenu(): FileTreeMenuState {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<ShownMenu>({
    align: 'start',
    anchor: null,
    target: { kind: 'space' },
  });
  const show = (next: ShownMenu) => {
    setShown(next);
    setOpen(true);
  };
  return {
    open,
    openPath: open && shown.target.kind === 'entry' ? shown.target.entry.path : null,
    openRow: (target, anchor) => show({ align: 'end', anchor, target }),
    setOpen,
    show,
    shown,
  };
}

/**
 * One menu for the whole tree. A right click on the section reads the row
 * under the pointer, and a row's "…" button names its own row, so a single
 * popup serves every row and the space between them without a menu root per
 * row.
 */
export function FileTreeMenu({
  actions,
  children,
  menu,
  render,
  resolveTarget,
  revealLabel,
}: {
  actions: FileTreeMenuActions;
  children: ReactNode;
  menu: FileTreeMenuState;
  /** The element a right click inside opens the menu from. */
  render: ReactElement<HTMLAttributes<HTMLElement>>;
  resolveTarget(event: MouseEvent<HTMLElement>): FileTreeMenuTarget;
  revealLabel: string;
}) {
  const rows = actionsFor(menu.shown.target, actions, revealLabel);
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    // A right click in a dialog the tree opened reaches here through React's
    // tree rather than the page's; it is not the tree's to answer.
    if (event.defaultPrevented) return;
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    event.preventDefault();
    menu.show({
      align: 'start',
      anchor: pointAnchor(event.clientX, event.clientY),
      target: resolveTarget(event),
    });
  };

  return (
    <DropdownMenu onOpenChange={menu.setOpen} open={menu.open}>
      {cloneElement(render, { onContextMenu }, children)}
      <DropdownContent
        align={menu.shown.align}
        anchor={menu.shown.anchor}
        aria-label={
          menu.shown.target.kind === 'space'
            ? 'Files actions'
            : `${menu.shown.target.entry.path} actions`
        }
        className="w-56"
      >
        {rows.map((row, index) =>
          row === 'separator' ? (
            <DropdownSeparator key={`after-${(rows[index - 1] as MenuAction).label}`} />
          ) : (
            <MenuItem
              destructive={row.destructive ?? false}
              disabled={row.disabled ?? false}
              icon={row.icon}
              key={row.label}
              label={row.label}
              onSelect={row.run}
              {...(row.switched === undefined ? {} : { switched: row.switched })}
            />
          ),
        )}
      </DropdownContent>
    </DropdownMenu>
  );
}
