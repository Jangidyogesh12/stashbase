import path from 'node:path';
import { extractorVersion } from './packaging/extractor-release.mjs';
import { fileURLToPath } from 'node:url';
import { buildExtractorComponent } from './packaging/extractor-component.mjs';
import { signExtractorComponent } from './packaging/sign-extractor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = await extractorVersion(root);
const source = path.join(root, 'python', 'sidecar.nosync', 'stashbase-extract');
await signExtractorComponent(source);
const result = await buildExtractorComponent({
  source, output: path.join(root, 'release.nosync'), version,
  manifestPath: path.join(root, 'python', 'sidecar.nosync', 'extractor-runtime.json'),
});
console.log(`[extractor-component] ${result.manifest.asset}: ${result.manifest.sizeBytes} bytes, sha256 ${result.manifest.sha256}`);
