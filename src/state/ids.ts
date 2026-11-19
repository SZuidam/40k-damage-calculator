let counter = 0;

/** Unique-enough id for library entries, rows and presets. */
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
