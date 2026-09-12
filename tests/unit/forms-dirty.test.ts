/**
 * tests/unit/forms-dirty.test.ts — `lib/forms/dirty.ts` `snapshotEntries` / `formIsDirty`
 * (05 T-UNIT-53; ADR-0039 D3; 03 §2.10 `EditorSections`; 00 S1.5c.AC2).
 *
 * Pure — no DOM, no network. `FormData` / `Blob` here are the Node globals (the same WHATWG shapes
 * the island feeds in from `new FormData(form).entries()`).
 */
import { describe, expect, it } from 'vitest';
import { formIsDirty, snapshotEntries, type FormSnapshot } from '@/lib/forms/dirty';

const keysOf = (snapshot: FormSnapshot): string[] => Object.keys(snapshot).sort();

describe('T-UNIT-53 snapshotEntries', () => {
  it('T-UNIT-53 no entries → an empty snapshot', () => {
    const snapshot = snapshotEntries([]);
    expect(keysOf(snapshot)).toEqual([]);
    expect(snapshot).toEqual({});
  });

  it('T-UNIT-53 keeps submission order and groups a repeated name into one value list', () => {
    const entries: [string, unknown][] = [
      ['title', 'Metal Pipe'],
      ['loaders', 'fabric'],
      ['slug', 'metal-pipe'],
      ['loaders', 'neoforge'],
      ['loaders', 'quilt'],
    ];
    expect(snapshotEntries(entries)).toEqual({
      title: ['Metal Pipe'],
      loaders: ['fabric', 'neoforge', 'quilt'],
      slug: ['metal-pipe'],
    });
  });

  it('T-UNIT-53 keeps empty strings (an emptied field is a value, not a removed key)', () => {
    expect(snapshotEntries([['description', '']])).toEqual({ description: [''] });
  });

  it('T-UNIT-53 skips non-string (File) values — uploads never count as unsaved (ADR-0039 D3)', () => {
    const entries: [string, unknown][] = [
      ['title', 'A'],
      ['icon', { name: 'icon.png', size: 12 }],
      ['gallery', new Blob(['png'])],
      ['count', 3],
      ['flag', null],
      ['nothing', undefined],
    ];
    expect(snapshotEntries(entries)).toEqual({ title: ['A'] });
  });

  it('T-UNIT-53 reads a real FormData: the file entry is dropped, the strings stay', () => {
    const form = new FormData();
    form.append('title', 'A');
    form.append('icon', new Blob(['png'], { type: 'image/png' }), 'icon.png');
    form.append('categories', 'tech');
    form.append('categories', 'utility');
    expect(snapshotEntries(form.entries())).toEqual({
      title: ['A'],
      categories: ['tech', 'utility'],
    });
  });

  it('T-UNIT-53 accepts any Iterable<[string, unknown]> (URLSearchParams, Map)', () => {
    expect(snapshotEntries(new URLSearchParams('a=1&a=2&b=3').entries())).toEqual({
      a: ['1', '2'],
      b: ['3'],
    });
    expect(snapshotEntries(new Map([['x', 'y']]).entries())).toEqual({ x: ['y'] });
  });

  it('T-UNIT-53 a field named __proto__ or constructor is a plain key', () => {
    const snapshot = snapshotEntries([
      ['__proto__', 'p'],
      ['constructor', 'c'],
    ]);
    expect(keysOf(snapshot)).toEqual(['__proto__', 'constructor']);
    expect(snapshot['__proto__']).toEqual(['p']);
    expect(snapshot['constructor']).toEqual(['c']);
    expect(Object.getPrototypeOf(snapshot)).toBeNull();
  });
});

describe('T-UNIT-53 formIsDirty', () => {
  const initial: FormSnapshot = {
    title: ['Metal Pipe'],
    description: ['A pipe.'],
    loaders: ['fabric', 'neoforge'],
  };

  it('T-UNIT-53 identical snapshots → false', () => {
    expect(formIsDirty(initial, { ...initial })).toBe(false);
    expect(
      formIsDirty(initial, {
        title: ['Metal Pipe'],
        description: ['A pipe.'],
        loaders: ['fabric', 'neoforge'],
      }),
    ).toBe(false);
  });

  it('T-UNIT-53 the same object on both sides → false', () => {
    expect(formIsDirty(initial, initial)).toBe(false);
  });

  it('T-UNIT-53 a changed value → true', () => {
    expect(formIsDirty(initial, { ...initial, title: ['Metal Pipe Mace'] })).toBe(true);
    expect(formIsDirty(initial, { ...initial, description: [''] })).toBe(true);
  });

  it('T-UNIT-53 an added key (a checkbox ticked) → true', () => {
    expect(formIsDirty(initial, { ...initial, comments_enabled: ['on'] })).toBe(true);
  });

  it('T-UNIT-53 a removed key (a checkbox unticked) → true', () => {
    const withoutDescription: FormSnapshot = {
      title: ['Metal Pipe'],
      loaders: ['fabric', 'neoforge'],
    };
    expect(formIsDirty(initial, withoutDescription)).toBe(true);
    expect(formIsDirty(withoutDescription, initial)).toBe(true);
  });

  it('T-UNIT-53 reordered values within a key → true (order-sensitive)', () => {
    expect(formIsDirty(initial, { ...initial, loaders: ['neoforge', 'fabric'] })).toBe(true);
  });

  it('T-UNIT-53 a value added to or removed from a key → true', () => {
    expect(formIsDirty(initial, { ...initial, loaders: ['fabric', 'neoforge', 'quilt'] })).toBe(
      true,
    );
    expect(formIsDirty(initial, { ...initial, loaders: ['fabric'] })).toBe(true);
    expect(formIsDirty(initial, { ...initial, loaders: [] })).toBe(true);
  });

  it('T-UNIT-53 empty forms → false; empty vs one key → true both ways', () => {
    expect(formIsDirty({}, {})).toBe(false);
    expect(formIsDirty({}, { a: ['1'] })).toBe(true);
    expect(formIsDirty({ a: ['1'] }, {})).toBe(true);
  });

  it('T-UNIT-53 the order of keys in the record is irrelevant', () => {
    const reordered: FormSnapshot = {
      loaders: ['fabric', 'neoforge'],
      description: ['A pipe.'],
      title: ['Metal Pipe'],
    };
    expect(Object.keys(reordered)).not.toEqual(Object.keys(initial));
    expect(formIsDirty(initial, reordered)).toBe(false);
    expect(formIsDirty(reordered, initial)).toBe(false);
  });

  it('T-UNIT-53 same key count but a different key → true', () => {
    expect(formIsDirty({ a: ['1'] }, { b: ['1'] })).toBe(true);
  });

  it('T-UNIT-53 snapshots built by snapshotEntries compare like literals (null prototype)', () => {
    const before = snapshotEntries([
      ['title', 'A'],
      ['tags', 'x'],
      ['tags', 'y'],
    ]);
    expect(
      formIsDirty(
        before,
        snapshotEntries([
          ['tags', 'x'],
          ['title', 'A'],
          ['tags', 'y'],
        ]),
      ),
    ).toBe(false);
    expect(
      formIsDirty(
        before,
        snapshotEntries([
          ['title', 'A'],
          ['tags', 'y'],
          ['tags', 'x'],
        ]),
      ),
    ).toBe(true);
    expect(formIsDirty(before, { title: ['A'], tags: ['x', 'y'] })).toBe(false);
  });

  it('T-UNIT-53 end to end: a FormData snapshot at mount vs after typing, an upload, and a submit-shaped reset', () => {
    const mount = new FormData();
    mount.append('title', 'A');
    mount.append('body_md', '');
    const atMount = snapshotEntries(mount.entries());

    const typed = new FormData();
    typed.append('title', 'A');
    typed.append('body_md', '# Hello');
    expect(formIsDirty(atMount, snapshotEntries(typed.entries()))).toBe(true);

    const uploaded = new FormData();
    uploaded.append('title', 'A');
    uploaded.append('body_md', '');
    uploaded.append('file', new Blob(['zip']), 'mod.jar');
    expect(formIsDirty(atMount, snapshotEntries(uploaded.entries()))).toBe(false);

    expect(formIsDirty(atMount, snapshotEntries(mount.entries()))).toBe(false);
  });
});
