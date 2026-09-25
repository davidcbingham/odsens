/**
 * lib/data/mentions.ts — the ISR read of `mentions` (registry Modules `data/mentions.ts`; 02 route
 * rows `/` "`mentions` (published, featured)", `/projects/[slug]` "`mentions` (published for
 * project)", `/seen-on` "`mentions` (published), `projects_public` (titles/types for tags + project
 * select)"; 02 RP-23 tags `mentions` + `projects`; 00 S1.8.AC2 / AC3 / AC8; ADR-0045).
 *
 * Server-only; the cookie-less anon client (01 INV-15). RLS already keeps draft / suggested /
 * hidden rows from anon (05 T-RLS-102) — the explicit `status = 'published'` filter stays anyway:
 * a hidden mention must vanish from all three public surfaces (00 S1.8.AC8), whatever a later
 * policy edit does. ONE cached reader serves Home, the project page and `/seen-on` (the ADR-0043
 * D6 precedent: one cache entry, one stale-while-revalidate window) under tags `mentions` +
 * `projects` with the pages' 600 s (01 INV-38); `createMention` / `updateMention` /
 * `refreshMentions` revalidate `mentions` (02 RP-22), and `projects` is carried because the rows
 * print a project's effective title and drop with its visibility. Render code never reads the
 * clock inside the cache — dates leave as ISO strings (03 C-19).
 *
 * The project join goes through `projects_public` (published, not `overrides.hidden`, title =
 * `title_override ?? title`) in a second read — `listPublishedProjects` carries no `id`. A mention
 * whose `project_id` is set but whose project is NOT publicly visible is DROPPED (ADR-0045): it
 * is never shown as "about OddSense generally" (that is what `project: null` means) and never
 * links to a 404. `thumbnailUrl` leaves as `mentionThumbnail(row)` — the i.ytimg.com literal for a
 * playable YouTube row, else `null`; a stored thumbnail from any other host never reaches a
 * component (ADR-0002 #33; 01 INV-54).
 *
 * The prop shapes are DECLARED in the pure client-safe `lib/mentions.ts` (the `MentionCard` /
 * `SeenOnGrid` client leaves may not import `@/lib/data/*` — 01 INV-09 Check) and re-exported here
 * with `export type`, so server callers still import them from the data layer. The surface orders
 * and totals are the pure helpers of the same module; `getHomeMentions` / `getProjectMentions` /
 * `getSeenOnMentions` only compose them over the one cached list.
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import {
  featuredMentions,
  mentionThumbnail,
  newestFirst,
  projectMentions,
  reachTotals,
  type PublishedMention,
  type ReachTotals,
} from '@/lib/mentions';
import { createAnonClient } from '@/lib/supabase/anon';

export type {
  MentionCardData,
  MentionFilters,
  MentionPlatform,
  PublishedMention,
  ReachTotals,
} from '@/lib/mentions';

const REVALIDATE_S = 600;
const TAG_MENTIONS = 'mentions';
const TAG_PROJECTS = 'projects';

const LIST_SELECT =
  'id, project_id, platform, url, external_id, title, creator_name, creator_url, published_at, view_count, featured, sort_order, created_at';

type MentionProject = NonNullable<PublishedMention['project']>;

async function fetchPublishedMentions(): Promise<PublishedMention[]> {
  const db = createAnonClient();
  const { data: rows, error } = await db
    .from('mentions')
    .select(LIST_SELECT)
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });
  if (error) throw new Error(`lib/data/mentions: list read failed — ${error.message}`);

  // Titles / types / slugs of the attached projects — only the publicly visible ones come back.
  const projectIds = [...new Set(rows.flatMap((row) => (row.project_id ? [row.project_id] : [])))];
  const projects = new Map<string, MentionProject>();
  if (projectIds.length > 0) {
    const { data: visible, error: projectsError } = await db
      .from('projects_public')
      .select('id, slug, title, project_type')
      .in('id', projectIds);
    if (projectsError) {
      throw new Error(`lib/data/mentions: projects read failed — ${projectsError.message}`);
    }
    for (const project of visible) {
      if (
        project.id === null ||
        project.slug === null ||
        project.title === null ||
        project.project_type === null
      ) {
        continue;
      }
      projects.set(project.id, {
        slug: project.slug,
        title: project.title,
        type: project.project_type,
      });
    }
  }

  const mentions = rows.flatMap((row): PublishedMention[] => {
    const project = row.project_id === null ? null : projects.get(row.project_id);
    // ADR-0045: attached to a project the public cannot see → not on any public surface.
    if (project === undefined) return [];
    return [
      {
        id: row.id,
        platform: row.platform,
        url: row.url,
        externalId: row.external_id,
        title: row.title,
        creatorName: row.creator_name,
        creatorUrl: row.creator_url,
        thumbnailUrl: mentionThumbnail({ platform: row.platform, externalId: row.external_id }),
        publishedAt: row.published_at === null ? null : new Date(row.published_at).toISOString(),
        viewCount: row.view_count,
        project,
        featured: row.featured,
        sortOrder: row.sort_order,
        createdAt: new Date(row.created_at).toISOString(),
      },
    ];
  });
  // The query already orders this way; `newestFirst` makes the pure helper THE definition of the order.
  return newestFirst(mentions);
}

/**
 * Every published mention whose project (if any) is publicly visible, newest first
 * (`published_at` desc, undated rows last, then `created_at` desc, then `id` — stable between
 * revalidations). Callers derive their surface with the pure helpers of `lib/mentions.ts`
 * (`featuredMentions`, `projectMentions`, `reachTotals`, `platformCounts`, `projectOptions`,
 * `applyMentionFilters`). Cached under tags `mentions` + `projects` (01 INV-38; 02 RP-23).
 */
export const listPublishedMentions = unstable_cache(
  fetchPublishedMentions,
  ['data-mentions-list'],
  { revalidate: REVALIDATE_S, tags: [TAG_MENTIONS, TAG_PROJECTS] },
);

/**
 * Home's IN THE WILD strip (02 §2.1 item 3): up to four featured mentions by `sort_order`, and the
 * reach totals over ALL published mentions (never the featured subset). `featured: []` → the page
 * renders no strip (00 S1.8.AC3).
 */
export async function getHomeMentions(): Promise<{
  featured: PublishedMention[];
  reach: ReachTotals;
}> {
  const mentions = await listPublishedMentions();
  return { featured: featuredMentions(mentions), reach: reachTotals(mentions) };
}

/**
 * One project's SEEN ON row (02 §2.3 item 5): its published mentions, featured first, then newest.
 * `[]` → the page renders no row (00 S1.8.AC3).
 */
export async function getProjectMentions(slug: string): Promise<PublishedMention[]> {
  return projectMentions(await listPublishedMentions(), slug);
}

/**
 * `/seen-on` (02 §2.6): the whole list, newest first, with the three `StatTile` totals. `mentions:
 * []` → the page renders its title only.
 */
export async function getSeenOnMentions(): Promise<{
  mentions: PublishedMention[];
  reach: ReachTotals;
}> {
  const mentions = await listPublishedMentions();
  return { mentions, reach: reachTotals(mentions) };
}
