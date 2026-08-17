# odsens.com — Design System (v1.2)

Spec for building odsens.com. Design only — no framework decisions here.

- **OddSense** — the person and the Minecraft character. The username shown on the site.
- **odsens** — the website and brand. Wordmark is always `ODSENS` in Bungee caps.
- No relation to any similarly-named studio. Never write "Odd Sense" as two words for the brand.
- No personal info anywhere: no real names, ages, locations. Users appear as a chosen handle plus optional picture, nothing else.

Gold note: the golds are pushed brighter and more saturated than the crown in the avatar (`--gold #FFC61F`) — deliberate, for punch and contrast on dark.

Direction: **Crate Poster** — blocky poster type on flat colour slabs, hard 2px edges, offset block shadows, zero blur. Playful and cartoony through shape and copy, never through visual noise. Pixel type is an accent only. Dark theme first; light theme optional later.

---

## 1. Colour tokens

Palette is sampled from the OddSense avatar (`assets/avatar.png`): navy-black ground, indigo-violet armour, two crown golds, emerald crown gems, white outline.

### Dark (default)

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#0D131B` | page ground |
| `--slab` | `#151E29` | cards, panels, nav bar |
| `--slab-raised` | `#1E2938` | hover fills, comment bubbles |
| `--slab-sunk` | `#111A24` | image wells, admin sidebar |
| `--slab-foot` | `#0F1721` | card footers, page footer |
| `--line` | `#263242` | default 2px border |
| `--line-strong` | `#3A4759` | secondary button border, dashed drops |
| `--line-soft` | `#2C3A4B` | chip borders, inputs |
| `--chalk` | `#EEF1F6` | body text, headings on dark |
| `--mute` | `#9DA9BA` | secondary text |
| `--mute-dim` | `#7C889A` | captions, meta, pixel eyebrows |
| `--indigo` | `#4B45D6` | primary actions, hero slab — **white text only** |
| `--indigo-deep` | `#2E2A9E` | pressed state, offset shadow under indigo |
| `--indigo-lift` | `#8B86F5` | links, hover borders, selected thumb |
| `--indigo-wash` | `#2A2680` | mod badge fill |
| `--gold` | `#FFC61F` | accent, section titles, exclusives, support |
| `--gold-bright` | `#FFDA6B` | text on gold-wash badges |
| `--gold-deep` | `#C08400` | offset shadow under gold |
| `--gold-wash` | `#4A3505` | resource-pack badge fill |
| `--gold-ink` | `#2E2000` | text on gold fills |
| `--emerald` | `#17B94F` | minor: download counts, approve, success |
| `--emerald-soft` | `#7FE3A2` | text on emerald-wash |
| `--emerald-wash` | `#0F3D22` | datapack badge fill, LIVE status |
| `--danger` | `#F0836B` | destructive text |
| `--danger-line` | `#4A2A2A` | destructive border |
| `--danger-field` | `#C05A45` | invalid input border |
| `--alert` | `#CC3A2A` | red/alert **fills** behind white micro-text (replaces `#E1493B`, which failed contrast) |
| `--orange` | `#E8762A` | CurseForge, in charts and source rows only |
| `--white` | `#FFFFFF` | avatar/image outline |

Emerald is a **minor** accent — it comes from the crown gems, not from glowing eyes. It never carries a headline, a primary action, or a hero.

### Light (optional, later)

`--paper #F4F2EA` · `--card #FFFFFF` · `--line #D9D3C3` · `--text #141A22` · `--indigo #3A34C4` · `--gold-text #8A6410`. Same structure, same shapes; gold becomes a text-safe deep gold.

### Contrast rules

- Safe: chalk/mute/gold/indigo-lift on ink; white on indigo; ink on gold; ink on emerald.
- Never: `--indigo` as text on `--ink` (**2.8:1**); emerald as body text; gold text on a gold slab; white micro-text on the old `#E1493B` — use `--alert #CC3A2A`.
- Never encode meaning in colour alone. Type badges carry a glyph **and** a word; statuses are spelled out; the active nav item carries a 3px gold underline.

---

## 2. Typography

Three faces, strict jobs. All three are **self-hosted woff2** — no font CDN, no external request on load: `Bungee`, `Space Grotesk` (400/500/700), `Silkscreen` (400/700).

- **Bungee** — display only. Page titles, project titles, section headers, primary button labels, wordmark. Always uppercase, leading 0.9–1.1, max ~6 words, **16px floor for titles**; 12–15px is allowed **only** on button, filter and support-button labels. Never a paragraph.
- **Space Grotesk** — everything readable. Body, descriptions, nav links, inputs, tables, version numbers, admin UI. 400 prose / 500 UI / 700 subheads.
- **Silkscreen** — pixel accent, micro-labels only. Eyebrows, download counts, badge text, section numbers. **Floor is 10px, and ≥11px whenever the label carries information** (download counts, HELD FOR REVIEW, unread/held counts, statuses). Letter-spacing .08–.2em. Never a sentence.

| Role | Size / face | Notes |
|---|---|---|
| Hero | 64px Bungee (36px phone) | leading .9 |
| Page title | 40px Bungee (30px phone) | |
| Section title | 24–26px Bungee, gold | |
| Card title | 17–20px Bungee | |
| Detail title | 46px Bungee (26px phone) | |
| Subhead | 19px Space Grotesk 700 | |
| Body | 17px / 1.65–1.7, max 68ch | 16px on phone |
| Small | 13–14px | meta, captions |
| Pixel label | 10–11px Silkscreen (11px if informational) | uppercase, letter-spaced |

---

## 3. Space, edges, depth

- Spacing scale, 4px base: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80.
- Card padding 20. Grid gap 20 (16–18 on dense grids). Section gap 64–80. Page gutter 24 phone / 40–56 desktop. Max content width 1200–1280.
- Radius: **0** everywhere by default; **3px** for inputs and version/loader chips only. Nothing is a pill except nothing.
- Borders are 2px, drawn as `outline` on cards so they never shift layout. **Card and panel outlines are `--line-soft #2C3A4B`** (lifted one step in v1.2 for visibility on dark); `--line` stays for internal dividers, footer strips and thin rules. 3px white border on avatars and portraits.
- Depth: flat offset blocks only — `box-shadow: 4px 4px 0 <deep>` (5–6px on hero/large). No blur, no gradient surfaces, no glows.
- The one texture: 45° diagonal hatch at 8–12% black, only on indigo or gold slabs.

## 4. Iconography

- 2px stroke, 24px grid, square caps and joins. No rounded ends, no filled illustrative icons.
- Each project type owns a solid glyph so type never depends on colour: **mod = square**, **datapack = diamond**, **resource pack = triangle**, **plugin = circle**.
- Third-party marks (Modrinth, CurseForge, YouTube, Ko-fi) use official logos at official colours inside a neutral slab.
- Minecraft imagery keeps `image-rendering: pixelated`. Never resize a screenshot to a non-integer scale if avoidable.

---

## 5. Components

Minimum hit target 44px everywhere. Focus is a 3px `--gold` ring with 2px offset, always visible for keyboards.

**Button — primary.** Bungee 14–15px, indigo fill, white text, `4px 4px 0 --indigo-deep`. Hover: fill `#5D57E8`, shadow 6px, element translates -2px/-2px. Active: fill `--indigo-deep`, no shadow, translate +2/+2. Disabled: `#22293A` fill, `#5D6779` text, no shadow. Gold variant (`--gold` fill, `--gold-ink` text, `--gold-deep` shadow) is reserved for the hero download and support actions.

**Button — secondary.** Space Grotesk 700 15px, `--slab` fill, 2px `--line-strong`. Hover: `--slab-raised` + `--indigo-lift` border. Active: ink fill + indigo border.

**Button — ghost.** Space Grotesk 700 15px, `--indigo-lift`, arrow suffix. Hover adds a 2px underline via inset shadow. Active turns gold.

**Type badge.** Glyph + word. 11px 700, letter-spacing .06–.08em, 7×11px padding, square. mod → indigo-wash/`#CFCCFF`; datapack → emerald-wash/emerald-soft; resource pack → gold-wash/gold-bright; plugin → `#243040`/chalk.

**Exclusive badge.** "★ ONLY ON ODSENS", Silkscreen 9–10px, gold fill, gold-ink text, hatch overlay, `3px 3px 0 --gold-deep`. Sits in the card's top-left corner (overlapping the border by 1px) and the card gains a gold outline. One per card. Never on a project that also lives on Modrinth or CurseForge.

**Version / loader chip.** 12px 500, 3px radius, 2px `--line-soft`, transparent fill. Selected: `--indigo-lift` fill with ink text. Unavailable: dim text, `--slab-raised` border, not clickable. Max four per card, then `+N`.

**Filter bar.** Slab strip with 2px line, Bungee 12px filter buttons with counts (`MODS 7`), active button = indigo fill. Version and sort are 3px-radius selects on the right. Active filters echo below as removable chips plus a "Clear" ghost link. On phone the type filters scroll horizontally and the selects stack.

**Project card.** Slab, 2px line, icon 64px (56 on tight grids, 52 phone) in an ink well with its own 2px border, Bungee title, one-line description in mute, up to two chips, then a footer strip (`--slab-foot`, 2px top border) holding the type badge left and the download count right in Silkscreen emerald. Hover: `--slab-raised` fill, `--indigo-lift` outline, `6px 6px 0 --indigo-deep`, translate -3px/-3px. Whole card is one link; the badge is not separately clickable.

**Gallery.** Big 16:9 well plus a thumbnail row (16:10, 5 across desktop / 4 phone, last one `+N`). Selected thumb takes the `--indigo-lift` outline. Lightbox: ink at 92% opacity, 44px square arrows, Esc closes, arrow keys move, caption 14px mute. Alt text required on every image.

**Comment bubble.** 40px square avatar (34px for replies) with 2px border. Handle 14px 700 + relative timestamp in mute-dim. Body in a `--slab-raised` bubble with 2px line. Creator comments get a gold "CREATOR" Silkscreen tag. Actions row: like button (`♥ 12`, 2px line; liked = `--indigo-lift` fill with ink text) and a "Reply" ghost.

**Reply.** One level of indentation only: 52px left margin, 16px left padding, 2px left border. Deeper replies stay flat and open with `@handle`.

**Held for review.** Bubble keeps the raised fill but takes a 2px **dashed** gold-deep border, a `⏳ HELD FOR REVIEW` Silkscreen gold label, and a line of plain copy: "Only you can see this until OddSense approves it. Usually quick." Visible to its author only.

**Sign-in prompt.** Slab panel: Bungee 17px title, one line of mute copy ("Sign in to comment. Your handle is all anyone sees."), then a chalk-filled "Continue with Google" button with dark text. After sign-in the user picks a handle and optional picture; the real name is never displayed or stored in view.

**Floating support button.** Gold fill, `♥ SUPPORT` in Bungee 13px, `4px 4px 0 --gold-deep`, bottom-right, 24px inset. Hides on scroll-down, returns on scroll-up. On phones it becomes a 52px gold square with the heart only.

**Nav.** Sticky top bar, 68px desktop / 56px phone, `--slab` with 2px bottom line. Avatar (40px, white border) + `ODSENS` wordmark, then links in Space Grotesk; active link is white 700 with a 3px gold underline (inset shadow). Right side: search (projects page), notification bell, Sign in / signed-in handle, gold support button. Under 900px links collapse into a 44px square menu button.

**Notification bell — cut from v1.** No user inbox in the first release. Replies and approvals are found by revisiting the thread; the admin side gets email instead (see Settings). If it returns later it uses `--alert #CC3A2A` for the count badge, never the old red.

**Footer.** `--slab-foot`, 2px top line, three columns: wordmark + one dry line ("Mods and other odd things, made by OddSense. Not affiliated with Mojang."), "Find me" links, "Site" links. Silkscreen column headers.

**Admin field.** Label 13px 700 chalk-mute, input on `--slab-sunk` with 2px `--line-soft` and 3px radius, 12–13px padding, helper text 12px mute-dim. Focus: `--indigo-lift` border. Invalid: `--danger-field` border + danger helper text in plain language ("Needs to be a number. Digits only.").

**Admin table.** 2px outline, header row on `--slab-sunk` with 2px bottom line, rows ≥44px separated by 2px `#1B2531`. Status is a worded pill (HELD gold-wash, LIVE emerald-wash). Actions: one filled Approve (emerald, ink text), the rest outlined; destructive actions use danger text on a danger-line border. One accent per row maximum.

---

## 6. Pages

1. **Home** — nav; hero is a **featured-project takeover**: indigo hatched slab with exclusive/new badges, 64px Bungee title, one-line dry description, gold DOWNLOAD + secondary "See the project", version chips; right rail holds a 16:9 screenshot and a short "OddSense makes things for Minecraft" strip with the avatar. Then Featured projects (4-up), then Latest videos (2-up) beside a "Find me" list (Modrinth / CurseForge / YouTube) and a compact gold tip panel. Footer.
2. **Projects** — page title + count line, search, filter bar (type counts + version + sort), active-filter chips, 3-up card grid (1-up phone). Empty state: "Nothing matches that. Try fewer filters."
3. **Project detail** — breadcrumb; 104px icon + 46px Bungee title + description + badge/chips/count row; gallery; ABOUT (markdown: h2/h3 in Bungee gold, body 17px, lists, note callout with a Silkscreen NOTE tag); VERSIONS & FILES table (file, Minecraft, loader, size, Download — the word "Download", never "Get"); comments with composer. Right rail: sticky "GET IT" panel (big primary download + file meta + Modrinth/CurseForge rows with their own counts + a line explaining the combined count), DETAILS list (type, updated, licence, source), gold tip panel. Phone stacks: header, gallery, about, files, comments; download panel becomes a section, not a sticky bar.
4. **Videos** — big embedded player, Bungee title, view/date meta, dry blurb, "Up next" list at right (132px thumbs, selected item gets the indigo-lift outline). Grid of older videos below on phone.
5. **Skins** (reserved style) — **every skin slot is a 3D render of the skin model, never a profile picture and never the flat texture.** The big panel is a live spinnable viewer (controls: spin / walk / front-back on a solid slab inside the viewer); the 4-up grid shows rendered busts in 3:4 slots with the 64×64 source PNG pinned small in the corner for reference. Name + description + DOWNLOAD PNG + Slim toggle sit under the viewer; selected card takes the indigo-lift outline; exclusive badge available here too. **The mockups cannot render 3D — those slots are labelled placeholders.** Build them with a browser skin viewer (e.g. skinview3d) reading `assets/skin-*.png`; the same renderer should generate the grid busts (a cached PNG render per skin is fine).
6. **Art** — filter row (all / avatars / thumbnails / icons), then a column-flow masonry where **each piece keeps its own dimensions**: images render at natural aspect ratio (`height: auto`, never cropped, never forced into a square), so wide thumbnails and tall squares pack flush with one 18px gutter. Four columns desktop, two phone, one under 480. Lightbox with title, year and optional download.
7. **Support** — gold hatched panel with $1 / $3 / $5 / Other (one preselected) and a single send button, so tipping is one or two clicks; Ko-fi handles the payment; "What it pays for" slab in plain copy; reserved dashed slot for the future supporters wall (handles only, no amounts).
8. **Custom orders** — type selector (mod / plugin / skin / pack / art), handle, "What do you want made" textarea with a helper line, then Minecraft version + **loader** + budget ("no idea is a valid answer"). The loader dropdown (Fabric / NeoForge / Forge / Paper / Spigot) renders **only when the type is mod or plugin** and is hidden for skin, pack and art; it carries a Silkscreen "MOD / PLUGIN ONLY" tag and a helper line. Then a public-posting checkbox, SEND IT, and an honest expectation line ("I reply in a few days. No promises, no invoices yet.").
9. **Admin** — 220px sidebar (Comments with count, Projects, Skins, Art, Orders, Settings; active item has a gold left bar), moderation queue table, add/edit forms, drag-drop file well. Palette stays, poster type goes: Space Grotesk labels, clarity over flair.

Breakpoints: phone ≤ 599, tablet 600–899 (2-up grids, collapsed nav), desktop ≥ 900, max content 1280.

---

## 7. Voice & tone

odsens talks like someone who thinks the joke is funnier if you don't point at it. State the thing. Stop.

**Do**
- "A mace made out of a metal pipe. It does the sound."
- "Works on 1.21. Probably works on 1.20. Untested."
- "Only on odsens. Not going anywhere else."
- "Sign in to comment. Your handle is all anyone sees."
- "Held for review. Usually quick."
- One idea per sentence, under ~12 words where possible. Lowercase in UI labels; caps only where Bungee lives. Own the limits — "untested" is funnier than a promise. Errors talk like a person: "That file didn't upload. Try again?"

**Don't**
- "The ULTIMATE mace experience!!! 🔥"
- "Revolutionary gameplay-changing mechanics."
- "Hey guys, welcome back to my website!"
- "Please consider supporting me, it really helps!!"
- "An error has occurred. Code 500."
- No emoji, no hype adjectives, no vlogger openers, no begging on the support panel, no robot error text, no exclamation stacking.

## 8. Motion

120–180ms, ease-out, 2–4px moves. Cards lift, shadows deepen, chips snap. One idle animation per page maximum. Nothing loops in the corner of your eye. Respect `prefers-reduced-motion`: drop transforms, keep colour changes.

## 9. Accessibility checklist

- 44px minimum targets; visible 3px gold focus ring on every interactive element.
- Meaning never rides on colour alone (glyph + word on badges, worded statuses, underlined active nav).
- Alt text on every project icon, screenshot, skin and art piece.
- Body text ≥16px, never below 13px anywhere; Silkscreen only for short uppercase labels.
- Headings in document order; the Bungee hero is the `h1`.
- Handles only — never render a real name, age or location, and don't accept them in a handle field.

## 10. Assets

- `assets/avatar.png` — OddSense avatar (5000×5000 PNG). Source of the palette. Used at 40px in nav, 56px in the home intro strip, and full-size in the Art gallery.
- `assets/art-*.png` — commissioned PFPs and renders (crowned duck, McTry, MrHams, ESC0M14, Galaxy, JG, two Minecraft renders). Feeding the Art gallery.
- `assets/skin-*.png` — eight 64×64 skin files (Me, Kitsune, Angel Ducky, Red Suited Ducky, Emo Duck, Basic Squid, Feltur, Brick Block). These are **source textures**, not display images: the site renders them as 3D models. Only the small corner reference thumbs use them flat, at integer scale with `image-rendering: pixelated`.
- `assets/thumb-*.png` — video thumbnails (every-effect, wither hunt, frog).
- Still needed: project icons, in-game project screenshots, and rendered 3D skin previews for the Skins viewer.

---

## 11. Pass 2 — accounts, moderation, admin, global states

Everything below is additive. Direction, palette, type and existing components are unchanged apart from the four corrections in §1–§3.

### 11.1 New components

**Handle field.** `@` prefix in mute inside the input well, 16px value, 3px radius, 2px border that carries the state: resting `--line-soft`, checking `--indigo-lift` + a three-square pixel pulse at the right, available `--emerald` + `✔`, invalid `--danger-field` + `✕`. Helper line under it is always present (never a tooltip): rules when resting, the plain-words reason when wrong, "That one's free." in `--emerald-soft` when available. A live `n / 20` counter sits beside it. Rules: 3–20 chars, `[A-Za-z0-9_]`, unique, and rejected if it parses as a real name (`first_last`) or an email — reason spoken plainly, never "invalid input".

**Square toggle.** A 20–22px square, not a switch: off = `--slab-sunk` fill with `--line-strong` border; on = filled (`--emerald` for notification switches, `--indigo-lift` for mode/selection) with a 2px `✔`. The word **ON / OFF** in 11px Silkscreen always sits next to it — state never rides on colour. Radio-style choices (moderation mode, order status) use the same square, one filled.

**Picture upload.** 88–120px square well, 2px border. Empty: `NO PICTURE` in 10px Silkscreen. Uploading: indigo border, percent in Silkscreen 11px, flat 10px progress bar. Error: danger fill/border, `!` glyph, "That didn't upload. Try again?". Done: the image with a 3px white border plus Change / Remove. Crop is square-only: dimmed original, 2px gold crop box, USE THIS / Cancel.

**Toast.** `--slab` slab, 2px `--line-soft`, **6px `--gold` left bar**, `4px 4px 0` offset, 14–15px Space Grotesk. Bottom-**left**, 24px inset, so it never fights the support button. Auto-dismisses at ~4s; content is three words max: "Comment posted." / "Saved." / "Copied." Errors are not toasts — they stay inline beside the thing that failed.

**Skeleton.** Flat slabs at two depths: `#1E2938` for headline/media blocks, `#1A2432` for text lines, inside the real card shells so nothing jumps on load. Slow opacity pulse (1.6s, 1 → .55), **no shimmer, no gradient**; `prefers-reduced-motion` holds them at .8. Never more than one screenful.

**Upload well.** Idle: dashed `--line-strong`, "Drop a file here / or pick one". Drag-over: `--slab-raised` fill, dashed `--indigo-lift`, "Let go." + the file name. Uploading: solid indigo border, file name, percent, flat bar, Cancel. Done: emerald square with `✔`, name + size, Remove. Error: danger fill/border with the actual number ("That's 82 MB. The limit is 50.") or the actual type. Limits are printed under the well at all times, 13px mute-dim.

**Stat tile.** Slab, 2px `--line-soft`, 11px Silkscreen label, 34px Bungee number, one 14px line of context (emerald if up, gold if it needs attention, mute otherwise). Four across desktop, 2×2 phone.

**Flat bar chart.** Stacked columns on a `--slab-sunk` well with a 2px border, 2–4px gaps, no axis lines, no gradients, no rounded caps. **Source colours are fixed app-wide:** Modrinth `--emerald #17B94F` · CurseForge `--orange #E8762A` · direct/odsens `--indigo-lift #8B86F5`. Same three wherever a source is colour-coded (charts, download rows, legends), always with a swatch **and** the word. Y labels and the `30 DAYS AGO / TODAY` ends are 11px Silkscreen. Phone shows 15 bars (two days each) and says so.

**Video facade.** Thumbnail + `rgba(ink,.35)` scrim, an 88px indigo square play block with a white triangle and `5px 5px 0` shadow, duration chip bottom-right (11px Silkscreen on ink, 2px border), and a `CLICK TO LOAD YOUTUBE` chip bottom-left. Nothing from YouTube loads until click. "Up next" rows (132px thumbs) and the Shorts row (9:16, 104px, gold duration chip) use the same facade; selected row keeps the `--indigo-lift` outline.

**Profile menu.** Nav trigger: 28px picture + handle + `▾` in a `--line-strong` outlined block. Open: 236px slab, `4px 4px 0`, header with 40px picture + handle + `SIGNED IN` in Silkscreen, then Your profile / Change handle / Change picture, and **Sign out** in `--danger` behind a 2px top border.

**Mod action row.** Small actions, one accent max: filled emerald **Approve**, outlined **Hide**, danger-bordered **Ban user**. Held and reported comments always show it; on ordinary comments it hides behind a square **Moderate ON/OFF** toggle in the thread header. A `MOD` Silkscreen tag (indigo-wash) sits beside the handle on a moderator's own comments, next to `CREATOR` where both apply. Ban asks once, inline, in plain words and says where to undo it.

### 11.2 Comment thread — actions and edge states

- **Own comment:** ghost **Edit** and **Delete**. Editing swaps the bubble for a focused input (indigo border) with SAVE / Cancel; saved edits show "· edited" in the meta. Delete asks once inline on a `#1A1416` / `--danger-line` strip: "Delete this comment?" → Delete it / Keep it.
- **Report (anyone):** ghost action opens an inline reason picker — Spam / Rude / Something else as 3px-radius chips, one selected in `--indigo-lift`, then SEND REPORT. Confirmation is one line: "Reported. OddSense will look at it."
- **Comment count** sits beside the COMMENTS section title in 11px Silkscreen (`14 TOTAL`), and beside the title on phone.
- **Empty thread:** "NO COMMENTS YET" in Bungee + "Say something." + one primary button.
- **Hidden comment:** the slot stays — sunk slab, 15px mute, "Hidden by a moderator." No handle, no body.
- **Deleted with replies:** the slot stays as "Deleted." in mute; its replies keep their indent and stay readable.
- **Banned user:** the composer is replaced by a slab with their dimmed avatar and one line — "You can't comment here." No lecture, no appeal form.
- **Comments closed:** sunk slab, `CLOSED` Silkscreen label, "Comments are off for this one. The old ones stay." Existing comments remain visible.
- **Composer error:** danger border on the field, one plain line under it ("That didn't post. Too many links."), the rule restated beside POST. Never a modal.
- **Held for review** is unchanged from v1; moderators see it with the action row and a `FIRST COMMENT` gold-wash tag.

### 11.3 New pages

10. **Handle onboarding** (first sign-in, blocking) — 560px slab centred on a faint 45° indigo hatch, `STEP 1 OF 1` eyebrow, "PICK A HANDLE", one line ("Pick a handle. It's all anyone will ever see."), handle field, optional picture with Upload / Skip, then a footer strip with **DONE** (disabled until the handle validates) and "You can change both later. Your Google name and email stay hidden." Phone: same order, full-width DONE, 26px title.
11. **Your profile** — 720px column: picture row (Change / Remove), handle row with SAVE and the consequence spelled out ("Changing it renames you on every comment you've left."), then a footer strip listing what we store with a link to Privacy and a **Delete account** action in danger.
12. **Privacy** — Bungee page title "WHAT WE KEEP", then gold Bungee h2s: What we store (Google account ID for sign-in, handle, optional picture, comments/likes/reports) · What we never show (real name, email, age, location) · Tips and downloads (Ko-fi's terms; counts are numbers) · Deleting your account. Closes on a NOTE callout: under 13, don't sign in — downloads work without an account.
13. **404** — 80px Bungee `404` in `--indigo`, "THAT PAGE DOESN'T EXIST", "Probably never did.", then GO HOME + "See the projects".
14. **Generic error** — 64px `--alert` square with `!` and a `5px 5px 0 #7A1F14` shadow, "SOMETHING BROKE", "Not your fault. Reload and it's usually fine. If it isn't, it's on the list.", RELOAD + Go home. No codes.
15. **Admin — Settings** — Moderation (two square radios: Hold first-time commenters / Auto-publish signed-in users, each with a plain consequence line) · Email me about (four square ON/OFF switches: new comment, reply to me, new order, new tip) · Moderators (table of handle + role user/mod/admin with Remove / Make mod, add by handle) · Ko-fi (page name, webhook `LIVE` emerald-wash or `NOT SET` gold-wash with what to do). SAVE SETTINGS + a "Saved." toast.
16. **Admin — Stats** — four stat tiles (downloads 7 days, downloads all time, comments with held count, tips 30 days) then one flat stacked bar chart of the last 30 days by source, with the honest line: "Modrinth and CurseForge report their own counts. Direct downloads are the ones we serve."
17. **Admin — Orders** — status filter chips with counts, then a table (handle · type · asked · status `NEW` gold-wash / `REPLIED` indigo-wash / `CLOSED` neutral · Open). Detail: handle + status tag, a four-up meta grid (type, version, loader, budget), the request in a sunk slab, **REPLY BY EMAIL** with "Opens your mail app. Their email is never shown on the site.", and a square status selector plus their public-posting answer.
18. **Admin sign-in gate** — 400px slab, "ADMINS ONLY" in Bungee, the chalk Google button. Nothing else on the page.

### 11.4 Support panel — implementation-aware

Ko-fi's panel is an iframe we cannot restyle, so ours is a **wrapper**: the gold hatched slab holds the copy and the $1 / $3 / $5 / Other picker (one preselected, ink-on-gold for the selected amount), and a single **CONTINUE ON KO-FI** button (`--gold-ink` fill on gold, or gold on ink inside the gold slab) hands off to Ko-fi's overlay. Under it, a labelled dashed slot shows where Ko-fi's own panel renders — their look, inside our frame, with our copy kept outside it. "What it pays for" and the reserved supporters wall (handles only, no amounts) are unchanged.

### 11.5 Videos

Long-form grid keeps its layout; **Shorts get their own row** below it — 9:16 facades at 104px with a gold duration chip, horizontally scrolling on phone. Everything on the page is a facade until clicked.

### 11.6 Footer

"Site" column now reads: Projects · Custom orders · Support · **How comments work** · **Privacy**.

### 11.7 Empty states

Videos "NO VIDEOS YET / They'll show up here when they exist." → channel link · Skins "NO SKINS YET / Working on it. Check the projects meanwhile." · Art "NO ART HERE YET / Nothing in this filter. Try \"all\"." · Projects "NOTHING MATCHES / Try fewer filters." → Clear filters · Admin orders "No orders yet / Quiet week. The form still works." Each is one Bungee line, one mute line, at most one action.

### 11.8 Mockups

- `odsens Screens - Accounts and Comments.dc.html` — onboarding (desktop + phone), handle field states, picture states + crop, profile menu, Your profile, comment thread (desktop + phone), every comment action and edge state.
- `odsens Screens - Admin and States.dc.html` — Admin Settings, Stats, Orders, upload well, admin gate, 404, error, skeletons (grid + detail + thread), empty states, toasts, support wrapper, video facades, Privacy + footer, and the phone set.
