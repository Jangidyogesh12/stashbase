import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorDiagnostic } from './error-diagnostics.ts';
import { diagnosticSchema } from '../shared/protocols/diagnostics.ts';

test('diagnostics preserve unknown reasons, native output and nested provider evidence while filtering credentials', () => {
  const cause = Object.assign(new Error('Unsupported encoding UTF-7'), { code: 'UNSUPPORTED_ENCODING', statusCode: 422, requestId: 'request-123' });
  const error = Object.assign(new Error('Installer checksum mismatch', { cause }), {
    code: 'CHECKSUM_MISMATCH', exitCode: 1, stderr: 'expected ABC received DEF\nAuthorization: Bearer top-secret-token',
  });
  const result = errorDiagnostic(error);
  assert.equal(result.message, 'Installer checksum mismatch');
  assert.equal(result.code, 'CHECKSUM_MISMATCH');
  assert.equal(result.exit_code, 1);
  assert.match(result.stderr!, /expected ABC received DEF/);
  assert.match(result.stack!, /error-diagnostics.test.ts/);
  assert.equal(result.causes?.[0]?.http_status, 422);
  assert.equal(result.causes?.[0]?.request_id, 'request-123');
  assert.equal(result.causes?.[0]?.code, 'UNSUPPORTED_ENCODING');
  assert.equal(JSON.stringify(result).includes('top-secret-token'), false);
  assert.deepEqual(errorDiagnostic(result), result);
  assert.equal(diagnosticSchema.safeParse(result).success, true);
});

test('bounded diagnostics retain both ends and tolerate cycles without capturing arbitrary objects', () => {
  const error = Object.assign(new Error('first ' + 'x'.repeat(20_000) + ' final reason'), { prompt: 'never copy prompt', body: { secret: 'never copy body' } });
  error.cause = error;
  const result = errorDiagnostic(error);
  assert.match(result.message, /^first/);
  assert.match(result.message, /final reason$/);
  assert.equal(result.truncated, true);
  assert.equal(result.causes, undefined);
  assert.equal(JSON.stringify(result).includes('never copy'), false);
  assert.equal(diagnosticSchema.safeParse(result).success, true);
});

test('large multilingual diagnostics obey one byte budget without losing both ends or their cause', () => {
  const diagnostic = errorDiagnostic({ message: `start ${'中文'.repeat(40_000)} end`, stack: '堆栈'.repeat(16_000),
    cause: { message: `cause-start ${'异常'.repeat(40_000)} cause-end`, stderr: '输出'.repeat(8_000) } });
  assert.ok(new TextEncoder().encode(JSON.stringify(diagnostic)).length <= 128_000);
  assert.match(diagnostic.message, /^start /);
  assert.match(diagnostic.message, / end$/);
  assert.match(diagnostic.causes![0].message, /cause-end$/);
  assert.equal(diagnostic.truncated, true);
});

test('spawn diagnostics retain errno and syscall without copying arguments or environment', () => {
  const result = errorDiagnostic(Object.assign(new Error('Could not start PDF extractor', {
    cause: Object.assign(new Error('spawn UNKNOWN'), { errno: -4094, syscall: 'spawn', code: 'UNKNOWN', spawnargs: ['PRIVATE'], env: { SECRET: 'PRIVATE' } }),
  }), { spawn_attempts: 2 }));
  assert.equal(result.causes?.[0]?.errno, -4094);
  assert.equal(result.causes?.[0]?.syscall, 'spawn');
  assert.equal(result.spawn_attempts, 2);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  assert.deepEqual(errorDiagnostic(result), result);
});
