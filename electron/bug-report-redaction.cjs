'use strict';

const os = require('node:os');

const REDACTED = '[REDACTED]';
const PRIVATE_KEY_PATTERN = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi;
const HEADER_PATTERN = /(^|\n)([ \t]*(?:(?:proxy-)?authorization|cookie|set-cookie)\s*:\s*)[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/gim;
const QUERY_PATTERN = /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|token)=)[^&#\s]+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const BASIC_PATTERN = /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi;
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const OPENAI_KEY_PATTERN = /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g;
const ANTHROPIC_KEY_PATTERN = /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g;
const AWS_CREDENTIAL_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const OPAQUE_LINE_PATTERN = /^[ \t]*[A-Za-z0-9+/]{40,}={0,2}[ \t]*$/gm;

function replaceCounted(text, expression, replacement, counts, kind) {
  return text.replace(expression, (...args) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
}

/**
 * Match only the exact home directory supplied by Node/Electron. Separator
 * runs are flexible so the same value is recognized in POSIX paths, Windows
 * paths, and JSON-escaped Windows paths. We never guess a username segment.
 */
function homeDirectoryVariants(homeDir = os.homedir()) {
  if (typeof homeDir !== 'string') return null;
  const trimmed = homeDir.replace(/[\\/]+$/, '');
  if (!trimmed || trimmed === '/') return null;
  const leadingSeparator = /^[\\/]/.test(trimmed);
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const isWindowsPath = /^[A-Za-z]:[\\/]/.test(trimmed) || /^\\\\/.test(trimmed);
  const posix = `${leadingSeparator ? '/' : ''}${parts.join('/')}`;
  const windows = `${leadingSeparator ? '\\' : ''}${parts.join('\\')}`;
  const jsonWindows = windows.replaceAll('\\', '\\\\');
  const variants = [...new Set([trimmed, posix, windows, jsonWindows])]
    .sort((left, right) => right.length - left.length);
  return { variants, caseInsensitive: isWindowsPath };
}

function replaceHomeVariant(text, variant, caseInsensitive, counts) {
  const haystack = caseInsensitive ? text.toLowerCase() : text;
  const needle = caseInsensitive ? variant.toLowerCase() : variant;
  let searchFrom = 0;
  let cursor = 0;
  let output = '';
  while (searchFrom < text.length) {
    const index = haystack.indexOf(needle, searchFrom);
    if (index === -1) break;
    const end = index + variant.length;
    const previous = text[index - 1];
    const next = text[end];
    // A separator-normalized POSIX home such as `\\Users\\Jane Doe` must
    // not match inside a different rooted path such as
    // `C:\\Users\\Jane Doe`. The exact home may follow log punctuation,
    // quotes, or a URI separator, but never a path/name prefix or drive colon.
    const hasStartBoundary = index === 0 || !/[A-Za-z0-9_.:-]/.test(previous);
    // Quoted longer directory names and an unquoted spaced path continuation
    // are not this home. In prose, whitespace or punctuation can terminate it.
    const quotedPath = previous === '"' || previous === "'";
    const spacedPathContinuation = /^[ \t]+[^\s"']*[\\/]/.test(text.slice(end));
    const proseBoundary = !quotedPath && !spacedPathContinuation && /[\s),;:!?\]{}]/.test(next ?? '');
    const hasEndBoundary = end === text.length || next === '/' || next === '\\'
      || next === '"' || next === "'" || next === '\r' || next === '\n' || proseBoundary;
    if (!hasStartBoundary || !hasEndBoundary) {
      searchFrom = index + 1;
      continue;
    }
    output += text.slice(cursor, index) + '~';
    cursor = end;
    searchFrom = end;
    counts.homePath = (counts.homePath ?? 0) + 1;
  }
  return output ? output + text.slice(cursor) : text;
}

function countHomeVariant(text, variant, caseInsensitive) {
  const counts = Object.create(null);
  replaceHomeVariant(text, variant, caseInsensitive, counts);
  return counts.homePath ?? 0;
}

function replaceHomePaths(text, counts, homeDir) {
  const home = homeDirectoryVariants(homeDir);
  if (!home) return text;
  return home.variants.reduce(
    (next, variant) => replaceHomeVariant(next, variant, home.caseInsensitive, counts),
    text,
  );
}

function fieldWords(field) {
  return String(field)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function hasAdjacentWords(words, first, second) {
  return words.some((word, index) => word === first && words[index + 1] === second);
}

function isSensitiveFieldName(field) {
  const words = fieldWords(field);
  if (words.length === 0) return false;
  if (words.some((word) => (
    word === 'token'
    || word === 'secret'
    || word === 'password'
    || word === 'passwd'
    || word === 'authorization'
    || word === 'cookie'
    || word === 'credential'
    || word === 'credentials'
  ))) return true;
  return hasAdjacentWords(words, 'api', 'key')
    || hasAdjacentWords(words, 'private', 'key')
    || hasAdjacentWords(words, 'access', 'key');
}

function isAlreadyRedacted(value) {
  const trimmed = String(value).trim();
  if (trimmed === REDACTED) return true;
  if (trimmed.length < 2) return false;
  const quote = trimmed[0];
  return (quote === '"' || quote === "'")
    && trimmed.at(-1) === quote
    && trimmed.slice(1, -1) === REDACTED;
}

function replacementForValue(value) {
  const trimmed = String(value).trim();
  if (trimmed.startsWith('"')) return `"${REDACTED}"`;
  if (trimmed.startsWith("'")) return `'${REDACTED}'`;
  return REDACTED;
}

function multilineFieldExpression() {
  return /(^|\n)([ \t]*["']?([A-Za-z][A-Za-z0-9_-]{1,127})["']?\s*:\s*(?:[>|][-+]?)?\s*\r?\n)((?:[ \t]+[^\r\n]*(?:\r?\n|$))+)/gm;
}

function namedFieldPrefixExpression() {
  return /(^|[^A-Za-z0-9_-])(["']?)([A-Za-z][A-Za-z0-9_-]{1,127})\2(\s*[:=]\s*)/gm;
}

function readFieldValue(text, start) {
  if (start >= text.length) return null;
  const quote = text[start];
  if (quote === '"' || quote === "'") {
    for (let index = start + 1; index < text.length; index += 1) {
      if (text[index] === '\\') {
        index += 1;
      } else if (text[index] === quote) {
        return { start, end: index + 1, value: text.slice(start, index + 1) };
      }
    }
    return null;
  }
  const match = /^[^\s,{}"';&\r\n]+/.exec(text.slice(start));
  return match ? { start, end: start + match[0].length, value: match[0] } : null;
}

function redactNamedFields(text, counts) {
  let next = text.replace(multilineFieldExpression(), (match, prefix, header, field) => {
    if (!isSensitiveFieldName(field)) return match;
    counts.secretField = (counts.secretField ?? 0) + 1;
    return `${prefix}${header}${REDACTED}\n`;
  });
  const expression = namedFieldPrefixExpression();
  let cursor = 0;
  let output = '';
  let match;
  while ((match = expression.exec(next)) !== null) {
    const field = match[3];
    if (!isSensitiveFieldName(field)) continue;
    const parsed = readFieldValue(next, expression.lastIndex);
    if (!parsed) continue;
    expression.lastIndex = parsed.end;
    if (isAlreadyRedacted(parsed.value)) continue;
    counts.secretField = (counts.secretField ?? 0) + 1;
    output += next.slice(cursor, parsed.start) + replacementForValue(parsed.value);
    cursor = parsed.end;
  }
  return output ? output + next.slice(cursor) : next;
}

/**
 * Deterministic, dependency-free report redaction. It returns only redacted
 * text and an aggregate count; matched values are never retained or exposed.
 */
function redactBugReportText(input, { homeDir = os.homedir() } = {}) {
  let text = typeof input === 'string' ? input : String(input ?? '');
  const counts = Object.create(null);

  // PEM blocks must be removed as one unit before line-oriented rules can
  // expose an interior base64 line.
  text = replaceCounted(text, PRIVATE_KEY_PATTERN, REDACTED, counts, 'privateKey');

  // HTTP header folding permits continuation lines beginning with whitespace.
  text = replaceCounted(
    text,
    HEADER_PATTERN,
    (_match, prefix, header) => `${prefix}${header}${REDACTED}`,
    counts,
    'header',
  );

  text = redactNamedFields(text, counts);
  text = replaceCounted(
    text,
    QUERY_PATTERN,
    (_match, prefix) => `${prefix}${REDACTED}`,
    counts,
    'queryValue',
  );
  text = replaceCounted(text, BEARER_PATTERN, `Bearer ${REDACTED}`, counts, 'bearer');
  text = replaceCounted(text, BASIC_PATTERN, `Basic ${REDACTED}`, counts, 'basic');
  text = replaceCounted(text, GITHUB_TOKEN_PATTERN, REDACTED, counts, 'githubToken');
  text = replaceCounted(text, OPENAI_KEY_PATTERN, REDACTED, counts, 'openAiKey');
  text = replaceCounted(text, ANTHROPIC_KEY_PATTERN, REDACTED, counts, 'anthropicKey');
  text = replaceCounted(text, AWS_CREDENTIAL_PATTERN, REDACTED, counts, 'awsCredential');

  // A tail can begin inside a folded credential or private-key block. A full
  // base64-like line is not useful report context, so fail closed on it.
  text = replaceCounted(text, OPAQUE_LINE_PATTERN, REDACTED, counts, 'opaqueBlock');
  text = replaceHomePaths(text, counts, homeDir);

  return {
    text,
    redactionCount: Object.values(counts).reduce((total, count) => total + count, 0),
  };
}

function countMatches(text, expression) {
  expression.lastIndex = 0;
  let count = 0;
  while (expression.exec(text) !== null) count += 1;
  expression.lastIndex = 0;
  return count;
}

function countUnredactedMatches(text, expression, valueFromMatch) {
  expression.lastIndex = 0;
  let count = 0;
  let match;
  while ((match = expression.exec(text)) !== null) {
    if (!isAlreadyRedacted(valueFromMatch(match))) count += 1;
  }
  expression.lastIndex = 0;
  return count;
}

function scanNamedFields(text) {
  let count = 0;
  text.replace(multilineFieldExpression(), (match, prefix, header, field) => {
    const value = match.slice(prefix.length + header.length).trim();
    if (isSensitiveFieldName(field) && !isAlreadyRedacted(value)) count += 1;
    return match;
  });
  const expression = namedFieldPrefixExpression();
  let match;
  while ((match = expression.exec(text)) !== null) {
    const field = match[3];
    if (!isSensitiveFieldName(field)) continue;
    const parsed = readFieldValue(text, expression.lastIndex);
    // A log may end mid-write. Recognizing a sensitive field without a
    // complete value cannot establish safety, even if redaction skipped it.
    if (!parsed) {
      count += 1;
      continue;
    }
    expression.lastIndex = parsed.end;
    if (!isAlreadyRedacted(parsed.value)) count += 1;
  }
  return count;
}

/**
 * Independent fail-closed scan for report text. Only category counts leave
 * this function; suspicious values are never returned to callers.
 */
function scanBugReportText(input, { homeDir = os.homedir() } = {}) {
  const text = typeof input === 'string' ? input : String(input ?? '');
  const counts = Object.create(null);
  const checks = [
    ['privateKey', PRIVATE_KEY_PATTERN],
    ['bearer', BEARER_PATTERN],
    ['basic', BASIC_PATTERN],
    ['githubToken', GITHUB_TOKEN_PATTERN],
    ['openAiKey', OPENAI_KEY_PATTERN],
    ['anthropicKey', ANTHROPIC_KEY_PATTERN],
    ['awsCredential', AWS_CREDENTIAL_PATTERN],
    ['opaqueBlock', OPAQUE_LINE_PATTERN],
  ];
  for (const [kind, expression] of checks) {
    const count = countMatches(text, expression);
    if (count > 0) counts[kind] = count;
  }
  const headers = countUnredactedMatches(
    text,
    HEADER_PATTERN,
    (match) => match[0].slice(match[1].length + match[2].length).trim(),
  );
  if (headers > 0) counts.header = headers;
  const queryValues = countUnredactedMatches(
    text,
    QUERY_PATTERN,
    (match) => match[0].slice(match[1].length),
  );
  if (queryValues > 0) counts.queryValue = queryValues;
  const secretFields = scanNamedFields(text);
  if (secretFields > 0) counts.secretField = secretFields;
  const home = homeDirectoryVariants(homeDir);
  if (home) {
    const homePaths = home.variants.reduce(
      (total, variant) => total + countHomeVariant(text, variant, home.caseInsensitive),
      0,
    );
    if (homePaths > 0) counts.homePath = homePaths;
  }
  const findingCount = Object.values(counts).reduce((total, count) => total + count, 0);
  return {
    safe: findingCount === 0,
    findingCount,
    findings: Object.freeze({ ...counts }),
  };
}

/** Redact, then independently scan before report content may proceed. */
function prepareBugReportText(input, {
  homeDir = os.homedir(),
  redact = redactBugReportText,
  scan = scanBugReportText,
} = {}) {
  const redacted = redact(input, { homeDir });
  if (!redacted || typeof redacted.text !== 'string') {
    return { ok: false, redactionCount: 0, findingCount: 1 };
  }
  const scanned = scan(redacted.text, { homeDir });
  if (!scanned?.safe) {
    return {
      ok: false,
      redactionCount: Number.isSafeInteger(redacted.redactionCount) ? redacted.redactionCount : 0,
      findingCount: Number.isSafeInteger(scanned?.findingCount) ? scanned.findingCount : 1,
    };
  }
  return {
    ok: true,
    text: redacted.text,
    redactionCount: Number.isSafeInteger(redacted.redactionCount) ? redacted.redactionCount : 0,
  };
}

module.exports = {
  REDACTED,
  prepareBugReportText,
  redactBugReportText,
  scanBugReportText,
};
