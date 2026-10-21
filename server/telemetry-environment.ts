/** Runtime admission shared by the host and native diagnostic entry points.
 * Source launches are real usage too; test runners and explicit suppression
 * remain excluded regardless of distribution. */
export function telemetryAvailable(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.STASHBASE_TELEMETRY_DISABLED !== '1'
    && !environment.NODE_TEST_CONTEXT
    && environment.NODE_ENV !== 'test'
    && !environment.VITEST
    && !environment.JEST_WORKER_ID;
}
