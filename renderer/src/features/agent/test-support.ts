/**
 * Agent values only a test can want: the real workspace runtime, so the app's
 * own tests can drive a chat the way the shell's binder does. The running app
 * builds it through `useAgentWorkspaceRuntime` and never calls this directly.
 *
 * A dependency rule admits this entry only from a `*.test.*` file.
 */
export { createAgentWorkspaceRuntime } from './application/workspace-runtime';
