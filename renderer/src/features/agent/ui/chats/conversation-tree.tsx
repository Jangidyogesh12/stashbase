/** The chat list in the sidebar: recency groups, each conversation as a row
 *  that opens on a click and renames in place on a slow second click or F2,
 *  and a per-row menu, from its "…" button or a right click, for renaming and
 *  deletion. Grouping and ordering are decided in the domain; this module owns
 *  the interaction and the editing affordance. */
import { CalendarClock, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownContent,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  pointAnchor,
  type DropdownAnchor,
} from '@/components/ui/dropdown';
import { caretOffsetAtPoint, InlineInput } from '@/components/ui/inline-input';
import { MenuItem } from '@/components/ui/menu-item';
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { TreeDisclosure } from '@/components/ui/tree-disclosure';
import type {
  AgentConversationGroup,
  AgentHistoryEntry,
  AgentConversationItem,
} from '@/features/agent/domain/conversation-history';
import { fontWeights } from '@/lib/font-weight';
import { AGENT_ICONS } from '@/shared/brand/agent-icons';

const CONVERSATION_PAGE_SIZE = 100;

/** The row's one menu. Its "…" button opens it beneath itself; a right click
 *  on the row opens the same menu at the pointer. */
interface RowMenu {
  /** A point for a right click; absent, the menu hangs from its "…". */
  anchor: DropdownAnchor | undefined;
  open: boolean;
}

function HistoryActions({
  entry,
  menu,
  title,
  onDelete,
  onMenuChange,
  onRename,
}: {
  entry: AgentHistoryEntry | undefined;
  menu: RowMenu;
  title: string;
  onDelete(entry: AgentHistoryEntry): void;
  onMenuChange(menu: RowMenu): void;
  onRename(): void;
}) {
  return (
    <DropdownMenu
      // The "…" opens the menu beneath itself, whatever a right click left.
      onOpenChange={(open) => onMenuChange({ anchor: open ? undefined : menu.anchor, open })}
      open={menu.open}
    >
      <DropdownTrigger
        render={
          <SidebarMenuAction aria-label={`Actions for ${title || 'chat'}`} showOnHover>
            <MoreHorizontal aria-hidden="true" />
          </SidebarMenuAction>
        }
      />
      <DropdownContent
        align={menu.anchor ? 'start' : 'end'}
        {...(menu.anchor ? { anchor: menu.anchor } : {})}
        className="w-40"
      >
        <MenuItem icon={Pencil} label="Rename" onSelect={onRename} />
        {entry && (
          <>
            <DropdownSeparator />
            <MenuItem destructive icon={Trash2} label="Delete" onSelect={() => onDelete(entry)} />
          </>
        )}
      </DropdownContent>
    </DropdownMenu>
  );
}

function ConversationRow({
  conversation,
  onActivate,
  onDelete,
  onRename,
  onRestore,
  scheduled,
}: {
  conversation: AgentConversationItem;
  onActivate(tabId: string): void;
  onDelete(entry: AgentHistoryEntry): void;
  onRename(conversation: AgentConversationItem, title: string): void;
  onRestore(entry: AgentHistoryEntry): void;
  /** Whether a scheduled task started this chat. */
  scheduled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [caretOffset, setCaretOffset] = useState<number | undefined>();
  const [title, setTitle] = useState(conversation.title);
  const [menu, setMenu] = useState<RowMenu>({ anchor: undefined, open: false });
  const AgentIcon = AGENT_ICONS[conversation.agent];

  const activate = () => {
    if (conversation.tabId) onActivate(conversation.tabId);
    else if (conversation.entry) onRestore(conversation.entry);
  };
  const beginEdit = (nextCaretOffset?: number) => {
    activate();
    setCaretOffset(nextCaretOffset);
    setTitle(conversation.title);
    setEditing(true);
  };
  const cancelEdit = () => {
    setTitle(conversation.title);
    setEditing(false);
  };
  const submitEdit = () => {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === conversation.title) {
      cancelEdit();
      return;
    }
    setEditing(false);
    void onRename(conversation, nextTitle);
  };

  return (
    <SidebarMenuItem>
      {editing ? (
        <SidebarMenuButton
          aria-label={`Editing ${conversation.title}`}
          className="pl-1.5"
          icon={AgentIcon}
          isActive={conversation.active}
          render={<div data-conversation-inline-editor="" />}
          tabIndex={-1}
        >
          <InlineInput
            aria-label={`Rename ${conversation.title}`}
            className="min-w-0 text-inherit [font:inherit]"
            {...(caretOffset === undefined ? {} : { caretOffset })}
            onCancel={cancelEdit}
            onChange={setTitle}
            onCommit={submitEdit}
            // The editor keeps the row's own weight, which is the same
            // whether the conversation is current or not.
            style={{ fontVariationSettings: fontWeights.normal }}
            value={title}
          />
        </SidebarMenuButton>
      ) : (
        <SidebarMenuButton
          className="pl-1.5"
          data-conversation=""
          icon={AgentIcon}
          isActive={conversation.active}
          onClick={activate}
          onDoubleClick={(event) => {
            event.preventDefault();
            const target = event.target instanceof HTMLElement ? event.target : event.currentTarget;
            beginEdit(caretOffsetAtPoint(target, event.clientX, event.clientY));
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ anchor: pointAnchor(event.clientX, event.clientY), open: true });
          }}
          onKeyDown={(event) => {
            if (event.key === 'F2') {
              event.preventDefault();
              beginEdit();
            }
            // The keys a context menu is asked for with open the row's menu
            // beneath its "…", on every platform.
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              event.preventDefault();
              setMenu({ anchor: undefined, open: true });
            }
          }}
          label={conversation.title}
          aria-label={`${conversation.title}${scheduled ? ', Scheduled run' : ''}${conversation.draft ? ', Draft' : ''}${conversation.status ? `, ${conversation.status}` : ''}`}
          title={conversation.title}
        >
          {conversation.status === 'Working…' || conversation.status === 'Waiting for approval' ? (
            // The row's short form of the chat's state; its name carries the
            // whole of it.
            <span className="text-caption text-muted-foreground">
              {conversation.status === 'Working…' ? 'Working' : 'Waiting'}
            </span>
          ) : conversation.draft ? (
            <span className="text-caption text-muted-foreground">Draft</span>
          ) : scheduled ? (
            <CalendarClock
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground"
              data-scheduled-run=""
              strokeWidth={1.75}
            />
          ) : undefined}
        </SidebarMenuButton>
      )}
      {!editing && (
        <HistoryActions
          entry={conversation.entry}
          menu={menu}
          title={conversation.title}
          onDelete={onDelete}
          onMenuChange={setMenu}
          onRename={() => beginEdit()}
        />
      )}
    </SidebarMenuItem>
  );
}

function ConversationGroup({
  group,
  onActivate,
  onDelete,
  onRename,
  onRestore,
  scheduled,
}: {
  group: AgentConversationGroup;
  onActivate(tabId: string): void;
  onDelete(entry: AgentHistoryEntry): void;
  onRename(conversation: AgentConversationItem, title: string): void;
  onRestore(entry: AgentHistoryEntry): void;
  scheduled: ReadonlySet<string>;
}) {
  const [visibleCount, setVisibleCount] = useState(CONVERSATION_PAGE_SIZE);
  const visibleItems = group.items.slice(0, visibleCount);

  return (
    <TreeDisclosure label={group.label}>
      <SidebarMenu aria-label={`${group.label} chats`}>
        {visibleItems.map((conversation) => (
          <ConversationRow
            conversation={conversation}
            key={conversation.id}
            onActivate={onActivate}
            onDelete={onDelete}
            onRename={onRename}
            onRestore={onRestore}
            scheduled={conversation.entry !== undefined && scheduled.has(conversation.entry.id)}
          />
        ))}
      </SidebarMenu>
      {visibleItems.length < group.items.length && (
        <Button
          className="mt-1 ml-1"
          onClick={() => setVisibleCount((count) => count + CONVERSATION_PAGE_SIZE)}
          variant="ghost"
        >
          Show more
        </Button>
      )}
    </TreeDisclosure>
  );
}

const NO_SCHEDULED_RUNS: ReadonlySet<string> = new Set();

export function ConversationTree({
  groups,
  onActivate,
  onDelete,
  onRename,
  onRestore,
  scheduled = NO_SCHEDULED_RUNS,
}: {
  groups: AgentConversationGroup[];
  onActivate(tabId: string): void;
  onDelete(entry: AgentHistoryEntry): void;
  onRename(conversation: AgentConversationItem, title: string): void;
  onRestore(entry: AgentHistoryEntry): void;
  /** Native ids of the chats scheduled tasks started, marked with a clock. */
  scheduled?: ReadonlySet<string> | undefined;
}) {
  return (
    <div className="space-y-1">
      {groups.map((group) => (
        <ConversationGroup
          group={group}
          key={group.id}
          onActivate={onActivate}
          onDelete={onDelete}
          onRename={onRename}
          onRestore={onRestore}
          scheduled={scheduled}
        />
      ))}
    </div>
  );
}
