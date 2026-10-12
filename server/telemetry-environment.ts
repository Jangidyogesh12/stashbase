/** Runtime admission shared by the host and native diagnostic entry points.
 * Test runner markers take precedence over inherited packaged-build flags. */
export function telemetryAvailable(packaged: boolean, environment: NodeJS.ProcessEnv = process.env): boolean {
  return packaged && environment.STASHBASE_TELEMETRY_DISABLED !== '1'
    && !environment.NODE_TEST_CONTEXT
    && environment.NODE_ENV !== 'test'
    && !environment.VITEST
    && !environment.JEST_WORKER_ID;
}
