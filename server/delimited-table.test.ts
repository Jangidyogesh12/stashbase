import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { guessTableEncoding, readDelimitedTable } from './delimited-table.ts';

function withFile(name: string, bytes: string | Buffer, run: (target: string) => Promise<void>) {
  return async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-table-'));
    const target = path.join(root, name);
    fs.writeFileSync(target, bytes);
    try {
      await run(target);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  };
}

async function rows(target: string, start = 0, count = 500): Promise<string[][]> {
  const table = await readDelimitedTable(target, path.basename(target), start, count);
  assert.equal(table.kind, 'table');
  return table.kind === 'table' ? table.rows : [];
}

test(
  'quoting follows spreadsheet rules: escaped quotes, delimiters and line breaks inside fields',
  withFile(
    'quotes.csv',
    '\uFEFFname,note,amount\r\n"Smith, J","said ""hi""\nthen left",12\r\nplain,"two\r\nlines",\r\n"after"tail,x"y,3\rlone,cr,4\n\nlast,"unterminated\n',
    async (target) => {
      const before = fs.readFileSync(target);
      const table = await readDelimitedTable(target, 'quotes.csv', 0, 50);
      assert.equal(table.kind, 'table');
      if (table.kind !== 'table') return;
      assert.equal(table.delimiter, ',');
      assert.deepEqual(table.rows, [
        ['name', 'note', 'amount'],
        ['Smith, J', 'said "hi"\nthen left', '12'],
        ['plain', 'two\r\nlines', ''],
        ['aftertail', 'x"y', '3'],
        ['lone', 'cr', '4'],
        [''],
        ['last', 'unterminated\n'],
      ]);
      assert.equal(table.rowCount, 7);
      assert.equal(table.columnCount, 3);
      assert.deepEqual(fs.readFileSync(target), before);
    },
  ),
);

test('a final line break adds no empty record and an empty file has no rows', async () => {
  await withFile('final.csv', 'a,b\n1,2\n', async (target) => {
    assert.deepEqual(await rows(target), [['a', 'b'], ['1', '2']]);
  })();
  await withFile('empty.csv', '', async (target) => {
    const table = await readDelimitedTable(target, 'empty.csv', 0, 10);
    assert.equal(table.kind === 'table' && table.rowCount, 0);
  })();
});

test('the delimiter is the one that splits records consistently, and TSV is always tabs', async () => {
  await withFile('semi.csv', 'Produkt;Preis;Notiz\nA;1,50;"x; y"\nB;2,00;z\n', async (target) => {
    const table = await readDelimitedTable(target, 'semi.csv', 0, 10);
    assert.equal(table.kind === 'table' && table.delimiter, ';');
    assert.deepEqual(await rows(target), [['Produkt', 'Preis', 'Notiz'], ['A', '1,50', 'x; y'], ['B', '2,00', 'z']]);
  })();
  await withFile('tabs.csv', 'a\tb, c\n1\t2, 3\n', async (target) => {
    assert.deepEqual(await rows(target), [['a', 'b, c'], ['1', '2, 3']]);
  })();
  await withFile('pipes.csv', 'a|b|c\n1|2|3\n', async (target) => {
    assert.deepEqual(await rows(target), [['a', 'b', 'c'], ['1', '2', '3']]);
  })();
  await withFile('data.tsv', 'a,b\tc\n', async (target) => {
    assert.deepEqual(await rows(target), [['a,b', 'c']]);
  })();
  await withFile('single.csv', 'only\nvalues\n', async (target) => {
    assert.deepEqual(await rows(target), [['only'], ['values']]);
  })();
});

test(
  'pages read from checkpoints match the records across scan chunks',
  async () => {
    // Multi-line quoted fields of varying length make record starts land
    // anywhere, including across the 1 MiB scan chunks and page reads.
    const expected: string[][] = [['id', 'text', 'value']];
    for (let i = 1; i < 6_000; i += 1) {
      expected.push([String(i), `line ${i}\n${'x'.repeat(i % 900)}, "q"`, `${i * 3}`]);
    }
    const csv = expected
      .map((row) => row.map((field) => (/[",\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field)).join(','))
      .join('\r\n');
    await withFile('large.csv', csv, async (target) => {
      assert.ok(fs.statSync(target).size > 2 * 1024 * 1024);
      const first = await readDelimitedTable(target, 'large.csv', 0, 1);
      assert.equal(first.kind === 'table' && first.rowCount, expected.length);
      for (const start of [0, 255, 256, 257, 2_047, 4_100, 5_990]) {
        assert.deepEqual(await rows(target, start, 20), expected.slice(start, start + 20), `rows from ${start}`);
      }
      assert.deepEqual(await rows(target, 5_999, 500), [expected[5_999]]);
      assert.deepEqual(await rows(target, 9_000, 10), []);
    })();
  },
);

test(
  'a changed file is scanned again rather than read against stale offsets',
  withFile('changing.csv', 'a,b\n1,2\n', async (target) => {
    const before = await readDelimitedTable(target, 'changing.csv', 0, 10);
    fs.writeFileSync(target, 'a,b,c\n"new\nvalue",2,3\n4,5,6\n');
    const after = await readDelimitedTable(target, 'changing.csv', 1, 10);
    assert.equal(after.kind, 'table');
    if (before.kind !== 'table' || after.kind !== 'table') return;
    assert.notEqual(after.version, before.version);
    assert.equal(after.rowCount, 3);
    assert.deepEqual(after.rows, [['new\nvalue', '2', '3'], ['4', '5', '6']]);
  }),
);

test(
  'a cancelled read stops waiting for the scan without failing other reads or later ones',
  withFile('large.csv', 'a,b\n'.repeat(1_000_000), async (target) => {
    const cancelled = new AbortController();
    const waiting = readDelimitedTable(target, 'large.csv', 0, 1, cancelled.signal);
    const kept = readDelimitedTable(target, 'large.csv', 0, 1);
    cancelled.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    const table = await kept;
    assert.equal(table.kind === 'table' && table.rowCount, 1_000_000);
    // Alone, a cancelled read ends the scan of a new version; the next read scans again.
    fs.appendFileSync(target, 'c,d\n');
    const alone = new AbortController();
    const stopped = readDelimitedTable(target, 'large.csv', 0, 1, alone.signal);
    alone.abort();
    await assert.rejects(stopped, { name: 'AbortError' });
    assert.deepEqual(await rows(target, 1_000_000, 1), [['c', 'd']]);
  }),
);

test('text that is not UTF-8 is named by its likely encoding instead of being decoded lossily', async () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('name,value\r\nA,1\r\n', 'utf16le')]);
  await withFile('utf16.csv', utf16, async (target) => {
    assert.deepEqual(await readDelimitedTable(target, 'utf16.csv', 0, 10), {
      encoding: 'utf-16le',
      kind: 'unsupported-encoding',
      name: 'utf16.csv',
    });
  })();
  // "产品,金额" in GBK, as Excel on Chinese Windows saves a CSV.
  const gbk = Buffer.from([0xb2, 0xfa, 0xc6, 0xb7, 0x2c, 0xbd, 0xf0, 0xb6, 0xee, 0x0a, 0x41, 0x2c, 0x31, 0x0a]);
  await withFile('gbk.csv', gbk, async (target) => {
    const table = await readDelimitedTable(target, 'gbk.csv', 0, 10);
    assert.equal(table.kind, 'unsupported-encoding');
    if (table.kind === 'unsupported-encoding' && guessTableEncoding(Buffer.from([0xc4, 0xe3])) !== null) {
      assert.equal(table.encoding, 'gb18030');
    }
  })();
  await withFile('latin1.csv', Buffer.from('caf\xe9,1\n', 'latin1'), async (target) => {
    assert.deepEqual(await readDelimitedTable(target, 'latin1.csv', 0, 10), {
      encoding: null,
      kind: 'unsupported-encoding',
      name: 'latin1.csv',
    });
  })();
  await withFile('binary.csv', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00]), async (target) => {
    assert.deepEqual(await readDelimitedTable(target, 'binary.csv', 0, 10), { kind: 'binary', name: 'binary.csv' });
  })();
});
