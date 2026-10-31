import { createHash, randomUUID } from 'node:crypto';

const SECRET_ASSIGNMENT = /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|passwd|client[_-]?secret|private[_-]?key)\s*[:=]\s*)([^\s,;]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const OPENAI_KEY = /\bsk-[A-Za-z0-9_-]{16,}\b/g;
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g;

export function redactText(value: string, maxChars = 4000): string {
  return value
    .slice(0, maxChars)
    .replace(SECRET_ASSIGNMENT, '$1[REDACTED]')
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(OPENAI_KEY, '[REDACTED_API_KEY]')
    .replace(GITHUB_TOKEN, '[REDACTED_GITHUB_TOKEN]');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newId(prefix: string): string {
  return prefix + '_' + randomUUID().replaceAll('-', '');
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function nonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function safeKeys(value: unknown): string[] {
  const record = asRecord(value);
  return Object.keys(record).filter((key) => !/token|secret|password|authorization|cookie|credential|key/i.test(key)).slice(0, 40);
}

export function byteLength(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return undefined;
  }
}
