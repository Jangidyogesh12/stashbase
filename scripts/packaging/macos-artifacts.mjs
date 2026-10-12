import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';

async function digest(file, algorithm, encoding) {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

/** Merge only after both native runners have verified their signed artifacts.
 * Validate every referenced payload before exposing a combined update channel. */
export async function mergeMacArtifacts({ directories, output, version, productName }) {
  const files = [];
  const copies = [];
  const dates = [];
  for (const arch of ['arm64', 'x64']) {
    const directory = directories[arch];
    const metadata = parse(await fs.readFile(path.join(directory, 'latest-mac.yml'), 'utf8'));
    if (metadata.version !== version) throw new Error(`${arch} update version mismatch`);
    const expected = ['zip', 'dmg'].map((ext) => `${productName}-${version}-mac-${arch}.${ext}`);
    if (!Array.isArray(metadata.files) || metadata.files.length !== expected.length
      || expected.some((name) => metadata.files.filter((file) => file.url === name).length !== 1)) {
      throw new Error(`${arch} metadata must reference its own ZIP and DMG`);
    }
    for (const file of metadata.files) {
      const source = path.join(directory, file.url);
      if ((await fs.stat(source)).size !== file.size
        || await digest(source, 'sha512', 'base64') !== file.sha512) {
        throw new Error(`${arch} update payload verification failed: ${file.url}`);
      }
      files.push(file);
      copies.push(source);
      // Generated blockmaps are optional; the updater can fall back to a full download.
      const blockmap = `${source}.blockmap`;
      if (await fs.stat(blockmap).then((stat) => stat.isFile(), () => false)) copies.push(blockmap);
    }
    if (metadata.releaseDate) dates.push(metadata.releaseDate);
  }
  const fallback = files.find((file) => file.url.endsWith('-x64.zip'));
  const metadata = { version, files, path: fallback.url, sha512: fallback.sha512,
    ...(dates.length ? { releaseDate: dates.sort().at(-1) } : {}) };
  await fs.mkdir(output, { recursive: true });
  // No writes occur before both sets pass. Existing assets are never overwritten.
  for (const source of copies) await fs.copyFile(source, path.join(output, path.basename(source)), fs.constants.COPYFILE_EXCL);
  await fs.writeFile(path.join(output, 'latest-mac.yml'), stringify(metadata), { flag: 'wx' });
  return metadata;
}

