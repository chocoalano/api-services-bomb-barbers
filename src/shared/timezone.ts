export const APP_TIMEZONE = 'Asia/Jakarta';
export const APP_TIMEZONE_OFFSET = '+07:00';

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

const ISO_WITH_TIMEZONE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i;
const DB_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value != null &&
  typeof value === 'object' &&
  Object.getPrototypeOf(value) === Object.prototype;

const parseTimestamp = (value: string | Date): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = value.trim();
  if (!raw) return null;

  if (ISO_WITH_TIMEZONE_PATTERN.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (DB_DATETIME_PATTERN.test(raw)) {
    const date = new Date(`${raw.replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
};

export const toJakartaIsoString = (value: string | Date): string | null => {
  const date = parseTimestamp(value);
  if (!date) return null;

  const local = new Date(date.getTime() + JAKARTA_OFFSET_MS);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `.${pad(local.getUTCMilliseconds(), 3)}${APP_TIMEZONE_OFFSET}`
  );
};

export function toJakartaResponse<T>(value: T, seen = new WeakSet<object>()): T {
  if (value instanceof Date) {
    return toJakartaIsoString(value) as T;
  }

  if (typeof value === 'string') {
    return (toJakartaIsoString(value) ?? value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJakartaResponse(item, seen)) as T;
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) return value;
    seen.add(value);

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = toJakartaResponse(item, seen);
    }
    return out as T;
  }

  return value;
}
