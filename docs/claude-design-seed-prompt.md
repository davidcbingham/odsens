# Seed prompt for the Claude Design session (paste everything below the line)

---

I'm OddSense — I make Minecraft mods, datapacks, resource packs, and plugins (18 projects on Modrinth, ~9k downloads; e.g. "Metal Pipe Mace", "Pixel Chameleon", "Heavy Spear", "Duck Crosshair", "Troll Resources"). I also have a YouTube channel (@OdSens). I'm building my own website, **odsens.com**, and I want you to help me design its visual system. We'll iterate here, then export a handoff bundle for Claude Code, where the site gets built.

## Naming
- **OddSense** = me and my Minecraft character (that's my username on the site).
- **odsens** = the website/brand. Keep them distinct.
- Not related in any way to "Odd Sense NYC" (a design studio) — ignore anything like that.

## Brand cues (my avatar)
Pixel-art Minecraft character: **purple** hoodie/armor, **gold crown**, **glowing green eyes**, black face, thick white outline on a near-black background. I'll upload the avatar and other art from my mods. Please pull the palette from the art rather than inventing one.

## Tone
**Playful and cartoony. Fun, relaxed, and inviting.** Blocky/pixel motifs are welcome (chunky borders, pixel icons, a bit of Minecraft flavor) but text must stay very readable and layouts clean — not a chaotic "gamer" site. Dark theme first; a light theme is optional later.

## What the site does (design for these)
1. **Home** — hero with my avatar (idea: a rotating 3D render of my actual Minecraft skin), a short intro, featured projects, latest videos, links to Modrinth / CurseForge / YouTube.
2. **Projects** — a grid of cards, filterable by type: **mod / datapack / resource pack / plugin**, and by Minecraft version. Card shows icon, title, one-line description, type badge, loader/version chips, download count. Some projects are **"only on odsens.com"** exclusives — need a special badge for that.
3. **Project detail page** — icon, gallery, long description (markdown), versions/files list, download buttons (Modrinth / CurseForge / direct download), combined download count, and a comment thread.
4. **Videos** — YouTube grid with an embedded player.
5. **Skins** — a section showing Minecraft skins I've made (3D viewer + download). Design details later; just reserve a style for it.
6. **Art** — profile pictures, thumbnails, and other original art in a gallery.
7. **Comments** — people sign in with Google, pick a handle + optional profile picture, then post. **Threaded replies** and **likes** on comments. Need: comment bubble, reply indentation, like button, "sign in to comment" state, and a "held for review" state.
8. **Support** — a Ko-fi tip panel embedded on the site (make tipping feel like 1–2 clicks) and a small floating "support" button site-wide. Later: a supporters wall / leaderboard.
9. **Custom Orders (future)** — a page where someone can describe a mod/skin they want made and hire me. Just a simple, friendly form-style layout for now.
10. **Admin area** (only I see it) — plain, functional forms for adding projects/skins/art, a comment moderation queue, and settings. Should still feel like the brand but prioritize clarity over flair.

## Rules
- **No personal info** anywhere in the design — no real names, ages, locations; users are shown by chosen handle only.
- Must work on phones as well as desktop.
- Accessibility: check contrast, especially purple-on-black and glowing-green text; don't rely on color alone for meaning.
- Motion should be light and playful, never distracting.

## What I want out of this session
1. Ask me a few quick questions first if you need to (e.g. how "pixel" vs "smooth" I want it).
2. Then build the design system: color tokens (dark + optional light), typography (a fun display face + a very readable body face), spacing/radius/border style, iconography rules, and these components with states: button (primary/secondary/ghost), type badge, exclusive badge, version/loader chip, project card, gallery, comment bubble + reply + like, sign-in prompt, floating support button, filter bar, nav + footer, admin form field/table.
3. Mock up **Home, Projects grid, and one Project detail page** (desktop + phone) using the system.
4. Include a short "voice & tone" note (how the site talks) and a do/don't list.
5. When we're happy, prepare the **handoff bundle for Claude Code** so my dad and I can bring it into the odsens repo, where we'll turn it into a `DESIGN.md` and build the site.

Let's start — first show me 2–3 quick palette/typography directions from my avatar so I can pick one.
