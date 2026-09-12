/**
 * lib/forms/dirty.ts — the unsaved-changes helper behind `EditorSections` (ADR-0039 D3; 03 §2.10
 * `EditorSections` "dirty tracking per form via `formIsDirty`"; 00 S1.5c.AC2; 05 T-UNIT-53).
 *
 * Pure and client-safe — no DOM types, no directive, no imports: the island hands it
 * `new FormData(form).entries()` at mount and again on every `input` / `change`, then compares.
 *   snapshotEntries(entries) → `{ name: [value, value, …] }` in submission order; non-string
 *     (File) entries are skipped — uploads commit at once and never count as unsaved (ADR-0039 D3).
 *   formIsDirty(initial, current) → true when a key was added or removed, or any value list differs
 *     (order-sensitive within a key; the order of keys in the record is irrelevant).
 */

/** Field name → its values in submission order (a checkbox group / `getAll` list has several). */
export type FormSnapshot = Record<string, string[]>;

/**
 * Builds a snapshot from FormData-shaped entries; non-string (File) values are skipped — uploads
 * never count as unsaved (ADR-0039 D3).
 */
export function snapshotEntries(entries: Iterable<[string, unknown]>): FormSnapshot {
  // Null prototype: a field named `__proto__` or `constructor` is a plain key, never a setter.
  const snapshot = Object.create(null) as FormSnapshot;
  for (const [name, value] of entries) {
    if (typeof value !== 'string') continue;
    const values = snapshot[name];
    if (values) values.push(value);
    else snapshot[name] = [value];
  }
  return snapshot;
}

/** True when the two snapshots differ in any key or any value (order-sensitive within a key). */
export function formIsDirty(initial: FormSnapshot, current: FormSnapshot): boolean {
  const initialKeys = Object.keys(initial);
  if (initialKeys.length !== Object.keys(current).length) return true;
  for (const key of initialKeys) {
    if (!Object.hasOwn(current, key)) return true;
    const before = initial[key] ?? [];
    const after = current[key] ?? [];
    if (before.length !== after.length) return true;
    for (let i = 0; i < before.length; i += 1) {
      if (before[i] !== after[i]) return true;
    }
  }
  return false;
}
