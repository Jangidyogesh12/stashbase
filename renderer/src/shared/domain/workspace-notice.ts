import type { FailureView } from '@/shared/domain/feature-error';

/** One line the window shows above the workspace, with a dismissal when the
 *  reader can clear it themselves. The tone decides how loudly it is said:
 *  a request of the reader's that came back refused is an alert, and a
 *  capability StashBase could not reach is a quiet status. The workspace and
 *  the settings feature both raise one, so the shape lives here. */
export interface WorkspaceNotice {
  /** Something to take up, beside the dismissal. A refusal the reader can only
   *  acknowledge carries none. */
  readonly action: { readonly label: string; readonly onAct: () => void } | null;
  readonly dismissLabel: string;
  readonly message: string;
  readonly onDismiss: (() => void) | null;
  /** Something offered rather than reported, drawn as a banner. */
  readonly offer?: boolean;
  readonly tone: FailureView['tone'];
}
