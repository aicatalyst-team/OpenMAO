export function dumpJson(value: unknown): string {
  return JSON.stringify(stabilize(value));
}

export function jsonEqual(left: unknown, right: unknown): boolean {
  return dumpJson(left) === dumpJson(right);
}

function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stabilize(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stabilize(item)]),
  );
}
