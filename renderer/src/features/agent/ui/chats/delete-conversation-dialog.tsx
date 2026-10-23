import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { AgentHistoryEntry } from '@/features/agent/domain/conversation-history';
import type { AgentHistoryMutation } from '@/features/agent/hooks/use-conversation-history';

export function DeleteConversationDialog({
  entry,
  failure,
  onClose,
  onDelete,
  pending,
  workspaceName,
}: {
  entry: AgentHistoryEntry | null;
  failure: string | null;
  onClose(): void;
  onDelete(entry: AgentHistoryEntry): Promise<AgentHistoryMutation>;
  pending: boolean;
  workspaceName: string;
}) {
  // Only a removal that went through closes the dialog; a refusal leaves it
  // open so the reason stays in front of the person who asked for it.
  const remove = async () => {
    if (!entry) return;
    if ((await onDelete(entry)).kind === 'done') onClose();
  };

  return (
    <ConfirmDialog
      confirmLabel="Delete"
      description={
        <>
          “{entry?.title}” will be removed from {workspaceName}. Project files will stay where they
          are. This cannot be undone.
        </>
      }
      destructive
      failure={failure}
      onCancel={onClose}
      onConfirm={() => void remove()}
      open={entry !== null}
      pending={pending}
      title="Delete chat?"
    />
  );
}
