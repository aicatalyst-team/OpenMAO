import { randomUUID } from "node:crypto";

export const ID_PATTERN = "^[a-z][a-z0-9]*_[0-9a-f]{32}$";
export const UTC_TIMESTAMP_PATTERN =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$";

const ID_REGEX = new RegExp(ID_PATTERN);
const PREFIX_REGEX = /^[a-z][a-z0-9]*$/;
const UTC_TIMESTAMP_REGEX = new RegExp(UTC_TIMESTAMP_PATTERN);

export function newId(prefix: string): string {
  if (!PREFIX_REGEX.test(prefix)) {
    throw new Error("ID prefix must start with a lowercase letter and contain lowercase alnum");
  }

  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function validateId(value: string): string {
  if (!ID_REGEX.test(value)) {
    throw new Error("ID must match prefix_uuid4hex");
  }

  return value;
}

export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function validateUtcTimestamp(value: string): string {
  if (!UTC_TIMESTAMP_REGEX.test(value)) {
    throw new Error("timestamp must be RFC3339 UTC");
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error("timestamp must be RFC3339");
  }

  return value;
}
