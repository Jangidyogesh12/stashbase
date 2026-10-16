import assert from 'node:assert/strict';
import test from 'node:test';
import { agentExecutableFor, type AgentId } from '../agent-contract.ts';
import { smokeNativeAgentProtocol } from '../agent-native-smoke.ts';

for (const id of ['claude', 'codex'] as const satisfies readonly AgentId[]) {
  test(`installed ${id} CLI exposes the native adapter protocol`, async () => {
    const executable = agentExecutableFor(id);
    assert.ok(executable, `${id} CLI is unavailable. Install it before running this opt-in compatibility check.`);
    const result = await smokeNativeAgentProtocol(id, executable);
    assert.equal(result.ok, true, result.message);
  });
}

// Antigravity is optional on development machines: the check runs where `agy` is installed.
test('installed antigravity CLI exposes the native adapter protocol', { skip: agentExecutableFor('antigravity') ? false : 'agy is not installed' }, async () => {
  const executable = agentExecutableFor('antigravity')!;
  const result = await smokeNativeAgentProtocol('antigravity', executable);
  assert.equal(result.ok, true, result.message);
});
