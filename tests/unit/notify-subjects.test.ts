/**
 * tests/unit/notify-subjects.test.ts — 05 T-UNIT-26: notification subjects (`lib/notify/deliver/email.ts`
 * `subjectFor` / `digestSubject`, 04 §3.7 N5). Every v1 kind maps to its N5 format; the digest reads
 * "<N> things from the allay"; no subject carries an emoji or an exclamation mark (DESIGN.md §7).
 * Pure — no render, no network (05 H-5).
 */
import { describe, expect, it } from 'vitest';
import { SUBJECT_MAX, digestSubject, subjectFor } from '@/lib/notify/deliver/email';

const TITLE = 'Metal Pipe Mace';

/** DESIGN.md §7: no emoji, no exclamation marks anywhere in the allay's subjects. */
const FORBIDDEN = /[!\p{Extended_Pictographic}]/u;

describe('T-UNIT-26 subjectFor (04 N5)', () => {
  it.each([
    ['comment.new', TITLE, `New comment on ${TITLE}`],
    ['comment.held', TITLE, `Held for review: ${TITLE}`],
    ['comment.reported', TITLE, `Reported comment on ${TITLE}`],
    ['sync.failed', 'modrinth', 'Sync failed: modrinth'],
    ['sync.stale', 'youtube', 'Sync stale: youtube'],
    ['digest', '6', '6 things from the allay'],
  ])('T-UNIT-26 %s → %j', (kind, title, expected) => {
    expect(subjectFor(kind, title)).toBe(expected);
  });

  it('T-UNIT-26 digestSubject(n) is "<N> things from the allay"', () => {
    expect(digestSubject(6)).toBe('6 things from the allay');
    expect(digestSubject(25)).toBe('25 things from the allay');
  });

  it('T-UNIT-26 a 120-char title is clipped so the subject is ≤ 60 code points and ends in … (03 E-06)', () => {
    const long = 'M'.repeat(120);
    for (const kind of ['comment.new', 'comment.held', 'comment.reported', 'comment.reply']) {
      const subject = subjectFor(kind, long);
      expect(Array.from(subject).length).toBeLessThanOrEqual(SUBJECT_MAX);
      expect(Array.from(subject).length).toBe(SUBJECT_MAX);
      expect(subject.endsWith('…')).toBe(true);
    }
    // Code points, not UTF-16 units: astral characters count once each.
    const astral = subjectFor('comment.new', '𝔐'.repeat(80));
    expect(Array.from(astral).length).toBe(SUBJECT_MAX);
    expect(astral.endsWith('…')).toBe(true);
    // Nothing that fits is touched.
    expect(subjectFor('comment.new', TITLE)).toBe(`New comment on ${TITLE}`);
    expect(subjectFor('comment.new', 'M'.repeat(45))).toBe(`New comment on ${'M'.repeat(45)}`);
  });

  it('T-UNIT-26 an unknown kind still yields a readable subject (kind: title)', () => {
    expect(subjectFor('comment.reply', TITLE)).toBe(`comment.reply: ${TITLE}`);
  });

  it('T-UNIT-26 subjects contain no emoji and no exclamation marks (DESIGN.md §7)', () => {
    const subjects = [
      subjectFor('comment.new', TITLE),
      subjectFor('comment.held', TITLE),
      subjectFor('comment.reported', TITLE),
      subjectFor('sync.failed', 'modrinth'),
      subjectFor('sync.stale', 'curseforge'),
      digestSubject(7),
    ];
    for (const subject of subjects) {
      expect(subject).not.toMatch(FORBIDDEN);
      expect(subject.trim()).toBe(subject);
    }
    // The regex itself catches the DESIGN.md "don't" examples.
    expect('The ULTIMATE mace experience!!! 🔥').toMatch(FORBIDDEN);
  });
});
