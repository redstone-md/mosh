export function shorten(value: string, head: number): string {
  if (!value) {
    return "—";
  }
  if (value.length <= head * 2 + 1) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-4)}`;
}

export function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
