import './__tests__/isolated-home.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { maybeConvert, cancelConversionAndWait, isConversionTextUnavailable, setDerivedNoteIndexer, getScheduledConversion } from './conversion.ts';
import { queueConvertibleSource } from './conversion-dispatch.ts';
import { MfsIndexer } from './indexer.mfs.ts';
import { getDaemon } from './mfs-daemon.ts';
import { closeStateDb } from './state-db.ts';

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('fixture did not settle');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('completed extraction releases its lane and text before semantic work finishes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-prepared-acceptance-'));
  const source = path.join(root, 'image.png');
  const derived = path.join(root, 'image.md');
  fs.writeFileSync(source, 'fixture image');
  let release!: () => void;
  const embedding = new Promise<void>((resolve) => { release = resolve; });
  let accepted = false;
  t.mock.method(getDaemon(), 'call', async (op: string, args: Record<string, unknown>) => {
    assert.equal(op, 'upsert');
    accepted = true;
    if (args.wait_for_index !== false) await embedding;
    return { outcome: 'added', total_ms: 1 };
  });
  const indexer = new MfsIndexer();
  setDerivedNoteIndexer((source, text) => indexer.upsertConvertedFile(source, fs.readFileSync(text, 'utf8')));
  let completed = false;
  const completion = maybeConvert(source, {
    kind: 'acceptance-fixture', lane: 'heavy', cost: 1, matches: () => true,
    derivedNote: () => derived, derivedReady: () => true,
    convert: async () => { fs.writeFileSync(derived, 'finished extracted text'); },
    cleanupDerived: () => fs.rmSync(derived, { force: true }),
  })!.then(() => { completed = true; });
  try {
    await until(() => completed);
    assert.equal(accepted, true);
    assert.equal(getScheduledConversion(source), null);
    assert.equal(isConversionTextUnavailable(source), false);
    assert.equal(fs.readFileSync(derived, 'utf8'), 'finished extracted text');
  } finally {
    release(); await completion;
    setDerivedNoteIndexer(async () => null);
    closeStateDb(); fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OCR cancellation returns only after a stubborn descendant releases the process group', { skip: process.platform === 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-ocr-cancel-'));
  const pidFile = path.join(root, 'child.pid');
  const binary = path.join(root, 'extractor');
  const leaf = "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)";
  fs.writeFileSync(binary, `#!${process.execPath}\nconst fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid)));setInterval(()=>{},1000);\n`, { mode: 0o755 });
  const previous = process.env.STASHBASE_EXTRACT_BIN;
  process.env.STASHBASE_EXTRACT_BIN = binary;
  const source = path.join(root, 'image.png'); fs.writeFileSync(source, 'fixture image');
  let pid = 0;
  try {
    queueConvertibleSource(source);
    await until(() => fs.existsSync(pidFile));
    pid = Number(fs.readFileSync(pidFile, 'utf8'));
    await cancelConversionAndWait(source, 'user-request');
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(getScheduledConversion(source), null);
  } finally {
    await cancelConversionAndWait(source, 'file-operation');
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* already reaped */ } }
    if (previous === undefined) delete process.env.STASHBASE_EXTRACT_BIN;
    else process.env.STASHBASE_EXTRACT_BIN = previous;
    closeStateDb(); fs.rmSync(root, { recursive: true, force: true });
  }
});
