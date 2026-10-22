import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DOWNLOAD_BUCKET, IMMUTABLE_CACHE, mirrorRelease } from './packaging/download-mirror.mjs';
import { releaseAssetContentType } from './github-release-api.mjs';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
const { values, positionals } = parseArgs({ options: { 'source-dir': { type: 'string' } }, allowPositionals: true });
const [tag] = positionals;
if (positionals.length !== 1 || !/^v\d+\.\d+\.\d+$/.test(tag ?? '')) {
  throw new Error('Usage: node scripts/mirror-release-downloads.mjs vX.Y.Z [--source-dir directory]');
}
const account = required('CLOUDFLARE_ACCOUNT_ID');
if (!/^[a-f0-9]{32}$/.test(account)) throw new Error('Invalid Cloudflare account ID');
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${account}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: required('R2_ACCESS_KEY_ID'), secretAccessKey: required('R2_SECRET_ACCESS_KEY') },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  maxAttempts: 4,
});
const github = (suffix) => JSON.parse(execFileSync('gh', ['api', `repos/liliu-z/stashbase/releases/${suffix}`], {
  encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
}));
const release = github(`tags/${tag}`);
const directory = values['source-dir'] ? path.resolve(values['source-dir']) :
  await mkdtemp(path.join(os.tmpdir(), 'stashbase-downloads-'));
try {
  await mirrorRelease({
    release,
    log: console.log,
    currentLatestTag: async () => github('latest').tag_name,
    async download(asset) {
      const file = path.join(directory, asset.name);
      if (values['source-dir']) return file; // Still checked against the official digest before upload.
      const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(15 * 60_000) });
      if (!response.ok || !response.body) throw new Error(`Download ${asset.name}: HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(file, { flags: 'wx' }));
      return file;
    },
    store: {
      async head(Key) {
        try {
          const object = await client.send(new HeadObjectCommand({ Bucket: DOWNLOAD_BUCKET, Key }));
          return { size: object.ContentLength, sha256: object.Metadata?.sha256 };
        } catch (error) {
          if (error.$metadata?.httpStatusCode === 404) return null;
          throw error;
        }
      },
      async putFile(asset, file, digest) {
        const object = await client.send(new PutObjectCommand({
          Bucket: DOWNLOAD_BUCKET, Key: asset.key, Body: createReadStream(file),
          ContentLength: digest.size, ContentMD5: Buffer.from(digest.md5, 'hex').toString('base64'),
          ContentType: releaseAssetContentType(asset.name),
          ContentDisposition: `attachment; filename="${asset.name}"`,
          CacheControl: IMMUTABLE_CACHE, Metadata: { sha256: digest.sha256 }, IfNoneMatch: '*',
        }));
        if (object.ETag !== `"${digest.md5}"`) throw new Error(`R2 upload checksum mismatch: ${asset.name}`);
      },
      async putManifest(manifest) {
        await client.send(new PutObjectCommand({
          Bucket: DOWNLOAD_BUCKET, Key: 'latest.json',
          Body: JSON.stringify(manifest, null, 2) + '\n',
          ContentType: 'application/json', CacheControl: 'public, max-age=60, must-revalidate',
        }));
      },
    },
  });
} finally {
  client.destroy();
  if (!values['source-dir']) await rm(directory, { recursive: true, force: true });
}
