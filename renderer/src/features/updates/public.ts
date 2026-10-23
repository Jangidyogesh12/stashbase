/** Update adapters, notice and Settings models, and development preview controls.
 * App composition binds the notice into the sidebar and the controls into Settings. */
export type { UpdatesPort } from './application/ports';
export { createUpdatesAdapter } from './infrastructure/updates-bridge';
export { useSoftwareUpdate } from './hooks/use-software-update';
export { useUpdateNotice, type UpdateNoticeViewModel } from './hooks/use-update-notice';
export { UpdateNotice } from './ui/update-notice';
export { UpdatePreview } from './ui/update-preview';
export { useUpdatePreview } from './hooks/use-update-preview';
