/**
 * tests/unit/settings-schema.test.ts — T-UNIT-28: `discordWebhookUrlSchema` (regex from 04 §1.3;
 * accepts `discordapp.com`; rejects `http://`, other hosts, trailing whitespace) plus, with no 05 ID
 * of their own, the schema-level twins of the 04 §1.3 / 05 §7.2 `updateSettings` validation rows
 * (the db lane's action test covers the same rows through `callAction`): `moderation_mode` enum,
 * emails lowercased + de-duplicated with the RAW list capped at 10, `''` webhook = clear, `kofi_page`
 * regex, `announcement_md` ≤ 2000, `matrix` v1 kinds only / two channels, and `setUserRoleInput`
 * (H1 handle, role enum). Addresses use `@localhost.test` (fixture policy F-3 spirit).
 */
import { describe, expect, it } from 'vitest';
import {
  ADMIN_EMAILS_MAX,
  DISCORD_WEBHOOK_URL_RE,
  KOFI_PAGE_RE,
  adminEmailsSchema,
  discordWebhookUrlSchema,
  discordWebhookUrlValue,
  setUserRoleInput,
  testDiscordWebhookInput,
  updateSettingsInput,
} from '@/lib/actions/settings.schema';
import { discordWebhookUrlPattern } from '@/lib/adapters/discord';

const GOOD = 'https://discord.com/api/webhooks/123/abcDEF_-xyz';

function issuesOf(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.success ? [] : (result.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('discordWebhookUrlSchema (T-UNIT-28)', () => {
  it.each([
    GOOD,
    'https://discord.com/api/webhooks/1/a',
    'https://discordapp.com/api/webhooks/987654321098765432/AbC-dEf_123',
  ])('T-UNIT-28 accepts %s', (url) => {
    expect(discordWebhookUrlSchema.safeParse(url)).toEqual({ success: true, data: url });
    expect(discordWebhookUrlValue.safeParse(url).success).toBe(true);
    expect(DISCORD_WEBHOOK_URL_RE.test(url)).toBe(true);
  });

  it("T-UNIT-28 accepts '' (= clear) — but discordWebhookUrlValue (the Test button) does not", () => {
    expect(discordWebhookUrlSchema.safeParse('')).toEqual({ success: true, data: '' });
    expect(discordWebhookUrlValue.safeParse('').success).toBe(false);
  });

  it.each([
    ['http://discord.com/api/webhooks/123/abc', 'http://'],
    ['https://example.com/api/webhooks/123/abc', 'another host'],
    ['https://canary.discord.com/api/webhooks/123/abc', 'a subdomain'],
    ['https://discord.com.evil.test/api/webhooks/123/abc', 'a look-alike host'],
    [`${GOOD} `, 'trailing whitespace'],
    [`${GOOD}\n`, 'trailing newline'],
    [` ${GOOD}`, 'leading whitespace'],
    ['https://discord.com/api/webhooks/abc/token', 'a non-numeric id'],
    ['https://discord.com/api/webhooks/123/', 'an empty token'],
    ['https://discord.com/api/webhooks/123', 'no token segment'],
    ['https://discord.com/api/webhooks/123/tok.en', 'a dot in the token'],
    ['https://discord.com/api/webhooks/123/token?wait=true', 'a query string'],
    ['https://discord.com/api/v10/webhooks/123/token', 'a versioned path'],
    ['discord.com/api/webhooks/123/token', 'no scheme'],
    ['javascript:alert(1)', 'a javascript: URL'],
  ])('T-UNIT-28 rejects %s (%s)', (url) => {
    const result = discordWebhookUrlSchema.safeParse(url);
    expect(result.success).toBe(false);
    expect(discordWebhookUrlValue.safeParse(url).success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("That doesn't look like a Discord webhook URL.");
    }
  });

  it('T-UNIT-28 non-strings fail (no coercion)', () => {
    for (const value of [null, undefined, 123, {}, [GOOD]]) {
      expect(discordWebhookUrlSchema.safeParse(value).success, String(value)).toBe(false);
    }
  });

  it('T-UNIT-28 the regex is the 04 §1.3 literal', () => {
    expect(DISCORD_WEBHOOK_URL_RE.source).toBe(
      '^https:\\/\\/(discord|discordapp)\\.com\\/api\\/webhooks\\/\\d+\\/[A-Za-z0-9_-]+$',
    );
    expect(DISCORD_WEBHOOK_URL_RE.flags).toBe('');
  });

  it('T-UNIT-28 the discord adapter carries the same pattern (source + flags parity)', () => {
    expect(discordWebhookUrlPattern).toBeInstanceOf(RegExp);
    expect(discordWebhookUrlPattern.source).toBe(DISCORD_WEBHOOK_URL_RE.source);
    expect(discordWebhookUrlPattern.flags).toBe(DISCORD_WEBHOOK_URL_RE.flags);
  });
});

describe('updateSettingsInput (04 §1.3 — schema-level twin of the action validation rows)', () => {
  it('everything is optional: {} parses to {}', () => {
    expect(updateSettingsInput.safeParse({})).toEqual({ success: true, data: {} });
  });

  it('moderation_mode: auto / hold_first_time pass; anything else fails on that path', () => {
    expect(updateSettingsInput.safeParse({ moderation_mode: 'auto' }).success).toBe(true);
    expect(updateSettingsInput.safeParse({ moderation_mode: 'hold_first_time' }).success).toBe(
      true,
    );
    for (const bad of ['off', 'AUTO', '', 1, null]) {
      const result = updateSettingsInput.safeParse({ moderation_mode: bad });
      expect(result.success, String(bad)).toBe(false);
      expect(issuesOf(result)).toEqual(['moderation_mode']);
    }
  });

  it('admin_notify_emails: trimmed, lowercased, de-duplicated (first appearance wins)', () => {
    const result = updateSettingsInput.safeParse({
      admin_notify_emails: [
        '  Seed-Admin@LOCALHOST.TEST ',
        'seed-admin@localhost.test',
        'Second@Localhost.Test',
        'seed-admin@localhost.test',
      ],
    });
    expect(result).toEqual({
      success: true,
      data: { admin_notify_emails: ['seed-admin@localhost.test', 'second@localhost.test'] },
    });
  });

  it('admin_notify_emails: 10 entries pass, 11 fail — and the cap applies to the RAW list (11 with duplicates still fails)', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `admin${i}@localhost.test`);
    expect(updateSettingsInput.safeParse({ admin_notify_emails: ten }).success).toBe(true);
    const eleven = [...ten, 'admin10@localhost.test'];
    const overflow = updateSettingsInput.safeParse({ admin_notify_emails: eleven });
    expect(overflow.success).toBe(false);
    expect(issuesOf(overflow)).toEqual(['admin_notify_emails']);
    const dupes = [...ten, 'ADMIN0@localhost.test'];
    expect(updateSettingsInput.safeParse({ admin_notify_emails: dupes }).success).toBe(false);
    expect(ADMIN_EMAILS_MAX).toBe(10);
    expect(adminEmailsSchema.safeParse([]).success).toBe(true);
  });

  it('admin_notify_emails: a malformed address, an over-long address or a non-string entry fails on its index', () => {
    for (const bad of ['not-an-email', 'a@b', 'seed admin@localhost.test', '@localhost.test', '']) {
      const result = updateSettingsInput.safeParse({
        admin_notify_emails: ['ok@localhost.test', bad],
      });
      expect(result.success, bad).toBe(false);
      expect(issuesOf(result), bad).toEqual(['admin_notify_emails.1']);
    }
    const tooLong = `${'a'.repeat(250)}@localhost.test`;
    expect(tooLong.length).toBeGreaterThan(254);
    expect(updateSettingsInput.safeParse({ admin_notify_emails: [tooLong] }).success).toBe(false);
    expect(updateSettingsInput.safeParse({ admin_notify_emails: [42] }).success).toBe(false);
    expect(updateSettingsInput.safeParse({ admin_notify_emails: 'a@localhost.test' }).success).toBe(
      false,
    );
  });

  it("discord_webhook_url: '' passes through as '' (clear), a valid URL passes, an invalid one fails, omitted stays absent", () => {
    expect(updateSettingsInput.safeParse({ discord_webhook_url: '' })).toEqual({
      success: true,
      data: { discord_webhook_url: '' },
    });
    expect(updateSettingsInput.safeParse({ discord_webhook_url: GOOD }).data).toEqual({
      discord_webhook_url: GOOD,
    });
    const bad = updateSettingsInput.safeParse({ discord_webhook_url: 'http://discord.com/x' });
    expect(bad.success).toBe(false);
    expect(issuesOf(bad)).toEqual(['discord_webhook_url']);
    const parsed = updateSettingsInput.parse({ kofi_page: 'oddsense' });
    expect('discord_webhook_url' in parsed).toBe(false);
  });

  it("kofi_page: ^[A-Za-z0-9_-]{1,40}$ or ''", () => {
    for (const ok of ['oddsense', 'Odd_Sense-2', 'a', 'x'.repeat(40), '']) {
      expect(updateSettingsInput.safeParse({ kofi_page: ok }).success, ok).toBe(true);
    }
    for (const bad of [
      'odd sense',
      'x'.repeat(41),
      'odd.sense',
      'ko-fi.com/oddsense',
      ' oddsense',
    ]) {
      const result = updateSettingsInput.safeParse({ kofi_page: bad });
      expect(result.success, bad).toBe(false);
      expect(issuesOf(result), bad).toEqual(['kofi_page']);
    }
    expect(KOFI_PAGE_RE.source).toBe('^[A-Za-z0-9_-]{1,40}$');
  });

  it('comments_closed_default: booleans only (no "true" strings)', () => {
    expect(updateSettingsInput.safeParse({ comments_closed_default: true }).success).toBe(true);
    expect(updateSettingsInput.safeParse({ comments_closed_default: false }).success).toBe(true);
    for (const bad of ['true', 1, 0, null]) {
      expect(
        updateSettingsInput.safeParse({ comments_closed_default: bad }).success,
        String(bad),
      ).toBe(false);
    }
  });

  it('announcement_md: null and ≤ 2000 characters pass; 2001 fails', () => {
    expect(updateSettingsInput.safeParse({ announcement_md: null }).success).toBe(true);
    expect(updateSettingsInput.safeParse({ announcement_md: 'x'.repeat(2000) }).success).toBe(true);
    const result = updateSettingsInput.safeParse({ announcement_md: 'x'.repeat(2001) });
    expect(result.success).toBe(false);
    expect(issuesOf(result)).toEqual(['announcement_md']);
  });

  it('matrix: the five v1 kinds × email/discord pass; a COMING LATER kind (tip.new) fails on its path', () => {
    const ok = [
      { kind: 'comment.new', channel: 'email', enabled: false },
      { kind: 'comment.held', channel: 'discord', enabled: true },
      { kind: 'comment.reported', channel: 'email', enabled: true },
      { kind: 'sync.failed', channel: 'discord', enabled: true },
      { kind: 'sync.stale', channel: 'discord', enabled: true },
    ];
    expect(updateSettingsInput.safeParse({ matrix: ok })).toEqual({
      success: true,
      data: { matrix: ok },
    });
    expect(updateSettingsInput.safeParse({ matrix: [] }).success).toBe(true);
    for (const kind of ['tip.new', 'order.new', 'mention.suggested', 'comment.reply', 'nope']) {
      const result = updateSettingsInput.safeParse({
        matrix: [ok[0], { kind, channel: 'email', enabled: true }],
      });
      expect(result.success, kind).toBe(false);
      expect(issuesOf(result), kind).toEqual(['matrix.1.kind']);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("That row isn't switchable yet.");
      }
    }
  });

  it('matrix: an unknown channel or a non-boolean enabled fails', () => {
    for (const channel of ['inapp', 'push', 'sms', 'Email', '']) {
      const result = updateSettingsInput.safeParse({
        matrix: [{ kind: 'comment.new', channel, enabled: true }],
      });
      expect(result.success, channel).toBe(false);
      expect(issuesOf(result), channel).toEqual(['matrix.0.channel']);
    }
    const enabled = updateSettingsInput.safeParse({
      matrix: [{ kind: 'comment.new', channel: 'email', enabled: 'yes' }],
    });
    expect(enabled.success).toBe(false);
    expect(issuesOf(enabled)).toEqual(['matrix.0.enabled']);
  });

  it('unknown keys are stripped (they never reach the site_settings update)', () => {
    const parsed = updateSettingsInput.parse({
      kofi_page: 'oddsense',
      owner_profile_id: '00000000-0000-4000-8000-000000000003',
      discord_webhook_url_raw: GOOD,
    });
    expect(parsed).toEqual({ kofi_page: 'oddsense' });
  });

  it('every message is plain words: no "invalid", no error codes, no exclamation marks (DESIGN.md §7)', () => {
    const result = updateSettingsInput.safeParse({
      moderation_mode: 'x',
      admin_notify_emails: ['bad'],
      discord_webhook_url: 'x',
      kofi_page: ' ',
      comments_closed_default: 'no',
      announcement_md: 'x'.repeat(2001),
      matrix: [{ kind: 'tip.new', channel: 'sms', enabled: 'y' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThanOrEqual(7);
      for (const issue of result.error.issues) {
        expect(issue.message).not.toMatch(/invalid|expected|received|undefined|!/i);
        expect(issue.message).toMatch(/\.$/);
      }
    }
  });
});

describe('testDiscordWebhookInput (04 §1.3)', () => {
  it('{} passes (url absent → the action falls back to the stored URL)', () => {
    expect(testDiscordWebhookInput.safeParse({})).toEqual({ success: true, data: {} });
  });

  it('a valid URL passes; "" and non-matching URLs fail on url', () => {
    expect(testDiscordWebhookInput.safeParse({ url: GOOD }).success).toBe(true);
    for (const bad of ['', 'http://discord.com/api/webhooks/1/a', `${GOOD} `]) {
      const result = testDiscordWebhookInput.safeParse({ url: bad });
      expect(result.success, JSON.stringify(bad)).toBe(false);
      expect(issuesOf(result)).toEqual(['url']);
    }
  });
});

describe('setUserRoleInput (04 §1.3 — H1 handle + role enum)', () => {
  it('{handle, role} with an H1 handle and a catalog role passes', () => {
    expect(setUserRoleInput.safeParse({ handle: 'seed_user', role: 'moderator' })).toEqual({
      success: true,
      data: { handle: 'seed_user', role: 'moderator' },
    });
    for (const role of ['user', 'moderator', 'admin']) {
      expect(setUserRoleInput.safeParse({ handle: 'abc', role }).success, role).toBe(true);
    }
  });

  it('a reserved handle (the seed admin `oddsense`) is structurally fine here — H3 is not applied', () => {
    expect(setUserRoleInput.safeParse({ handle: 'oddsense', role: 'admin' }).success).toBe(true);
    expect(setUserRoleInput.safeParse({ handle: 'admin', role: 'user' }).success).toBe(true);
  });

  it('role outside the enum fails on role with plain words', () => {
    for (const role of ['owner', 'Admin', '', null, undefined]) {
      const result = setUserRoleInput.safeParse({ handle: 'seed_user', role });
      expect(result.success, String(role)).toBe(false);
      expect(issuesOf(result)).toEqual(['role']);
      if (!result.success) expect(result.error.issues[0]?.message).toBe('Pick a role.');
    }
  });

  it.each([
    ['@seed_user', 'No @ — we add it.'],
    ['ab', 'Too short. 3 characters minimum.'],
    ['a'.repeat(21), 'Too long. 20 characters maximum.'],
    ['seed-user', 'Letters, numbers and underscore only.'],
    ['seed user', 'Letters, numbers and underscore only.'],
    ['sééd', 'Letters, numbers and underscore only.'],
  ])('handle %j fails with %j', (handle, message) => {
    const result = setUserRoleInput.safeParse({ handle, role: 'user' });
    expect(result.success).toBe(false);
    expect(issuesOf(result)).toEqual(['handle']);
    if (!result.success) expect(result.error.issues[0]?.message).toBe(message);
  });

  it('a missing or non-string handle fails on handle', () => {
    for (const handle of [undefined, null, 42]) {
      const result = setUserRoleInput.safeParse({ handle, role: 'user' });
      expect(result.success, String(handle)).toBe(false);
      expect(issuesOf(result)).toEqual(['handle']);
    }
  });
});
