import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { extractorAssetName } from '../shared/extractor-runtime.ts';

test('packaged PDF probes wait for an installed component without demanding a download or dev scripts', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stashbase-pdf-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const resources = path.join(root, 'resources');
  const data = path.join(root, 'data');
  const manifest = {
    schema: 1, version: '1.0.0', platform: process.platform, arch: process.arch,
    asset: extractorAssetName('1.0.0', process.platform, process.arch),
    sha256: 'a'.repeat(64), sizeBytes: 1,
  };
  await fs.mkdir(path.join(resources, 'python'), { recursive: true });
  await fs.writeFile(path.join(resources, 'python', 'extractor-runtime.json'), JSON.stringify(manifest));
  const run = (installed: boolean) => promisify(execFile)(process.execPath, [
    '--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { EventEmitter } from 'node:events';
      import { PassThrough } from 'node:stream';
      globalThis.fetch = async () => { throw new Error('probe must not download'); };
      const launches = [];
      let outcome = { code: 0, signal: null, stderr: '' };
      childProcess.spawn = (cmd, args) => {
        launches.push({ cmd, args });
        const proc = Object.assign(new EventEmitter(), {
          stderr: new PassThrough(), stdout: new PassThrough(), exitCode: outcome.code, signalCode: outcome.signal,
        });
        setImmediate(() => { proc.stderr.write(outcome.stderr); proc.emit('exit', outcome.code, outcome.signal); proc.emit('close', outcome.code, outcome.signal); });
        return proc;
      };
      syncBuiltinESMExports();
      const { PDF_SPEC } = await import('./server/pdf.ts');
      const host = await import('./server/python-host.ts');
      try {
        const cost = await PDF_SPEC.classifyCost('/fixture.pdf', new AbortController().signal);
        assert.equal(cost, ${installed ? 0 : 10});
        if (${installed}) {
          await PDF_SPEC.convert('/fixture.pdf');
          assert.equal(launches.length, 2);
          assert.equal(launches[0].cmd, launches[1].cmd);
          assert.equal(launches[0].args[0], 'pdf');
          assert.equal(launches[0].args[1], '--probe-text-layer');
          assert.equal(launches[1].args[0], 'pdf');
          assert.equal(launches[1].args[1], '/fixture.pdf');
          const abort = AbortSignal.abort();
          assert.equal(await PDF_SPEC.classifyCost('/fixture.pdf', abort), 10);
          assert.equal(launches.length, 2);
          const { IMAGE_SPEC } = await import('./server/image.ts');
          const { errorDiagnostic } = await import('./server/error-diagnostics.ts');
          for (const code of [7, null]) {
            outcome = { code, signal: code === null ? 'SIGTERM' : null,
              stderr: ['native extraction failed token=private-token', 'frame 1', 'frame 2', 'frame 3', 'worker exit'].join(String.fromCharCode(10)) };
            for (const [spec, file] of [[PDF_SPEC, '/fixture.pdf'], [IMAGE_SPEC, '/fixture.png']]) {
              await assert.rejects(spec.convert(file), error => {
                const diagnostic = errorDiagnostic(error);
                assert.equal(diagnostic.exit_code, code ?? undefined);
                assert.equal(diagnostic.signal, outcome.signal ?? undefined);
                assert.match(diagnostic.stderr, /native extraction failed/);
                assert.doesNotMatch(JSON.stringify(diagnostic), /private-token/);
                assert.equal(error.name, spec === PDF_SPEC && code === null ? 'TransientConversionError' : 'Error');
                return true;
              });
            }
          }
        } else {
          assert.equal(launches.length, 0);
          assert.throws(() => host.extractorSpawn('pdf', 'pdf_extract.py', []), /component is not ready/);
        }
      } finally { await host.closeExtractorRuntime(); }
    `,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STASHBASE_APP_ROOT: path.join(resources, 'app.asar'),
      STASHBASE_RESOURCES_PATH: resources,
      STASHBASE_LOCAL_DATA_ROOT: data,
      STASHBASE_DEV_RUNTIME: '', STASHBASE_DEV_VITE: '', STASHBASE_PYTHON: '', STASHBASE_EXTRACT_BIN: '',
      STASHBASE_TELEMETRY_DISABLED: '1',
    },
  });
  const missing = await run(false);
  assert.doesNotMatch(missing.stdout + missing.stderr, /text probe skipped|script not found/i);
  await assert.rejects(fs.access(path.join(data, 'components', 'extractor', 'requested.json')));
  const installed = path.join(data, 'components', 'extractor', manifest.sha256);
  await fs.mkdir(path.join(installed, 'stashbase-extract'), { recursive: true });
  await fs.writeFile(path.join(installed, 'installed.json'), JSON.stringify({ sha256: manifest.sha256 }));
  await fs.writeFile(path.join(installed, 'stashbase-extract', process.platform === 'win32' ? 'stashbase-extract.exe' : 'stashbase-extract'), 'fixture');
  await run(true);
});
