/**
 * The result of reconciling a folder against disk.
 *
 * Every list is present even when empty — the renderer distinguishes "no
 * changes" from "sync did not run" by whether it got a result at all, not by
 * a missing key. `cancelled` means the caller abandoned the run because its
 * folder or window stopped being current, so the lists hold partial work
 * rather than a complete picture.
 */
export interface SyncResult {
  added: string[];
  modified: string[];
  removed: string[];
  /** Folder-relative file failures and unreadable child directories. Skipped
   * directories retain their previous index and derived state; readable peers
   * can still appear in the successful mutation lists. */
  failed: { name: string; error: string }[];
  /** True when the caller deliberately abandoned the sync because the
   *  target folder/window is no longer current. Any arrays are partial work
   *  completed before cancellation was observed. */
  cancelled?: boolean;
}
