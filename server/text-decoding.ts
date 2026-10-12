/** Strict decoding for source families whose contract requires safe UTF-8. */
const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });

export function decodeDirectTextBytes(sourceName: string, bytes: Uint8Array): string {
  if (/\.txt$/iu.test(sourceName)) {
    try {
      // Validation is separate from Buffer decoding so a leading UTF-8 BOM
      // remains in the returned source string and can round-trip unchanged.
      fatalUtf8.decode(bytes);
    } catch {
      throw unsupportedEncodingError(sourceName);
    }
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
}

/** Decode only the bounded preview prefix for a TXT listing. `stream: true`
 * keeps a multibyte character split at the preview boundary from being
 * mistaken for an encoding failure; the full source is validated when it is
 * opened or indexed. */
export function decodeDirectTextPreview(sourceName: string, bytes: Uint8Array): string {
  if (!/\.txt$/iu.test(sourceName)) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
  } catch {
    return '';
  }
}

function unsupportedEncodingError(sourceName: string): Error {
  const err = new Error(
    `${sourceName} is not valid UTF-8. StashBase will not display, index, or rewrite unsupported text encodings.`,
  ) as Error & { code: string; status: number };
  err.code = 'UNSUPPORTED_ENCODING';
  err.status = 415;
  return err;
}
